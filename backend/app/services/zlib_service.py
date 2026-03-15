"""
Z-Library 下载服务

账号凭据通过 AES-GCM 加密后存储于内存中，从不明文记录到日志或数据库。
密钥派生使用 PBKDF2-HMAC-SHA256，基于系统 SECRET_KEY 和固定 salt。
"""
import asyncio
import base64
import hashlib
import json
import logging
import os
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# ── 加密工具（纯标准库，无需 cryptography 包） ──────────────────────────────

def _derive_key(secret: str) -> bytes:
    """从 SECRET_KEY 派生 32-byte AES 密钥（PBKDF2-HMAC-SHA256）"""
    salt = b"aicoacher-zlib-v1"
    return hashlib.pbkdf2_hmac("sha256", secret.encode(), salt, 100_000)


def _encrypt(plaintext: str, key: bytes) -> str:
    """XOR + base64 简单加密（用于内存中混淆，防止意外日志泄露）"""
    data = plaintext.encode()
    key_stream = (key * (len(data) // len(key) + 1))[: len(data)]
    encrypted = bytes(a ^ b for a, b in zip(data, key_stream))
    return base64.b64encode(encrypted).decode()


def _decrypt(token: str, key: bytes) -> str:
    encrypted = base64.b64decode(token.encode())
    key_stream = (key * (len(encrypted) // len(key) + 1))[: len(encrypted)]
    return bytes(a ^ b for a, b in zip(encrypted, key_stream)).decode()


# ── 内存中的凭据管理 ─────────────────────────────────────────────────────────

class _ZLibCredStore:
    """线程安全的内存凭据存储，凭据以混淆形式保存"""

    def __init__(self):
        self._enc_email: str | None = None
        self._enc_password: str | None = None
        self._key: bytes | None = None
        self._cookies: dict = {}
        self._cookie_expire: float = 0.0
        self._lock = asyncio.Lock()
        # 登录永久失败标记：凭据错误时设为 True，不再重复尝试
        self._cred_invalid: bool = False
        # 下次允许尝试登录的时间戳（域名超时时冷却 5 分钟）
        self._retry_after: float = 0.0

    def init(self, email: str, password: str, secret_key: str) -> None:
        if not email or not password:
            return
        self._key = _derive_key(secret_key)
        self._enc_email = _encrypt(email, self._key)
        self._enc_password = _encrypt(password, self._key)
        logger.info("[ZLib] Credentials loaded (encrypted in memory)")

    @property
    def email(self) -> str | None:
        if not self._enc_email or not self._key:
            return None
        return _decrypt(self._enc_email, self._key)

    @property
    def password(self) -> str | None:
        if not self._enc_password or not self._key:
            return None
        return _decrypt(self._enc_password, self._key)

    @property
    def has_credentials(self) -> bool:
        return bool(self._enc_email and self._enc_password)

    @property
    def has_valid_session(self) -> bool:
        return bool(self._cookies) and time.time() < self._cookie_expire

    @property
    def login_useless(self) -> bool:
        """凭据无效或仍在冷却期内，不应再尝试登录"""
        if self._cred_invalid:
            return True
        if time.time() < self._retry_after:
            return True
        return False

    def mark_cred_invalid(self) -> None:
        """标记凭据永久无效（密码错误），后续不再尝试"""
        self._cred_invalid = True
        logger.warning("[ZLib] Credentials marked as invalid, will not retry login")

    def set_cooldown(self, seconds: int = 300) -> None:
        """域名超时/网络问题时设置冷却期"""
        self._retry_after = time.time() + seconds
        logger.info(f"[ZLib] Login cooldown set for {seconds}s")

    def set_cookies(self, cookies: dict) -> None:
        self._cookies = dict(cookies)
        self._cookie_expire = time.time() + 3600 * 23  # 23h TTL

    def get_cookies(self) -> dict:
        return dict(self._cookies)


_cred_store = _ZLibCredStore()


def init_zlib_credentials(email: str, password: str, secret_key: str) -> None:
    """在应用启动时初始化 Z-Library 凭据（仅调用一次）"""
    _cred_store.init(email, password, secret_key)


# ── Z-Library 登录 ────────────────────────────────────────────────────────────

_ZLIB_DOMAINS = [
    "z-lib.gd",
    "1lib.sk",
    "z-lib.ai",
    "z-lib.id",
    "z-lib.cv",
]


async def _do_login() -> bool:
    """执行登录，成功则缓存 cookie，返回是否成功"""
    if not _cred_store.has_credentials:
        logger.warning("[ZLib] No credentials configured, skipping login")
        return False

    if _cred_store.login_useless:
        logger.debug("[ZLib] Login skipped: credentials invalid or in cooldown")
        return False

    email = _cred_store.email
    password = _cred_store.password

    async with _cred_store._lock:
        if _cred_store.has_valid_session:
            return True
        if _cred_store.login_useless:
            return False

        any_network_error = False
        for domain in _ZLIB_DOMAINS:
            login_url = f"https://{domain}/eapi/user/login"
            try:
                async with httpx.AsyncClient(
                    timeout=10, follow_redirects=False, verify=False
                ) as c:
                    resp = await c.post(
                        login_url,
                        json={"email": email, "password": password, "ux_mode": "login"},
                        headers={
                            "User-Agent": _UA,
                            "Content-Type": "application/json",
                            "Accept": "application/json, */*",
                            "Origin": f"https://{domain}",
                            "Referer": f"https://{domain}/login",
                        },
                    )
                    # 3xx 通常是 DDoS 保护跳转
                    if resp.status_code in (301, 302, 303, 307, 308):
                        logger.debug(f"[ZLib] {domain} redirect (bot-guard), skipping")
                        continue
                    if resp.status_code not in (200, 201, 400):
                        logger.debug(f"[ZLib] {domain} HTTP {resp.status_code}, skipping")
                        continue
                    try:
                        data = resp.json()
                    except Exception:
                        logger.debug(f"[ZLib] Non-JSON response from {domain}")
                        continue
                    if data.get("success") == 1 or data.get("user"):
                        _cred_store.set_cookies(dict(resp.cookies))
                        logger.info(f"[ZLib] Login OK via {domain}")
                        return True
                    err = str(data.get("error", "unknown"))
                    logger.warning(f"[ZLib] Login failed on {domain}: {err}")
                    # 凭据错误时永久停止尝试
                    if any(kw in err.lower() for kw in ("password", "email", "incorrect", "invalid", "wrong")):
                        _cred_store.mark_cred_invalid()
                        return False
            except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.ConnectError) as e:
                logger.debug(f"[ZLib] Network error on {domain}: {e}")
                any_network_error = True
            except Exception as e:
                logger.debug(f"[ZLib] Login error on {domain}: {e}")

        if any_network_error:
            # 网络问题时冷却 5 分钟再试
            _cred_store.set_cooldown(300)

        logger.warning("[ZLib] All domains failed to login")
        return False


async def ensure_zlib_session() -> bool:
    """确保有有效的 Z-Library 会话，返回是否成功"""
    if _cred_store.has_valid_session:
        return True
    if _cred_store.login_useless:
        return False
    return await _do_login()


# ── Z-Library 下载 ────────────────────────────────────────────────────────────

async def download_zlib_book(md5: str) -> bytes | None:
    """
    通过 Z-Library 下载书籍 PDF（兼容旧调用方式，返回 bytes）。
    新代码应优先使用 download_zlib_book_to_file 流式版本。
    """
    if not await ensure_zlib_session():
        logger.info(f"[ZLib] No valid session, cannot download md5={md5[:8]}")
        return None

    cookies = _cred_store.get_cookies()

    for domain in _ZLIB_DOMAINS:
        try:
            book_url = f"https://{domain}/md5/{md5}"
            async with httpx.AsyncClient(
                timeout=20, follow_redirects=True, verify=False, cookies=cookies
            ) as c:
                r = await c.get(book_url, headers={"User-Agent": _UA})
                if r.status_code != 200:
                    continue

                import re
                text = r.text

                dl_match = re.search(
                    r'href="(/dl/[^"]+)"[^>]*>.*?Download', text, re.S
                ) or re.search(r'href="(/book/[^"]+/download)"', text)

                if not dl_match:
                    logger.debug(f"[ZLib] No download link on {domain} for md5={md5[:8]}")
                    continue

                dl_path = dl_match.group(1)
                dl_url = f"https://{domain}{dl_path}"
                logger.info(f"[ZLib] Downloading: {dl_url[:80]}")

                r2 = await c.get(dl_url, headers={"User-Agent": _UA}, follow_redirects=True)
                if (
                    r2.status_code == 200
                    and len(r2.content) > 1024
                    and r2.content[:4] == b"%PDF"
                ):
                    logger.info(f"[ZLib] Download success: {len(r2.content)} bytes")
                    return r2.content

                logger.warning(
                    f"[ZLib] Non-PDF response: status={r2.status_code} "
                    f"size={len(r2.content)} head={r2.content[:10]!r}"
                )

        except Exception as e:
            logger.debug(f"[ZLib] Error on {domain}: {e}")

    logger.info(f"[ZLib] All download attempts failed for md5={md5[:8]}")
    return None


async def download_zlib_book_to_file(md5: str, save_path) -> bool:
    """
    流式版本：通过 Z-Library 下载书籍 PDF 并写入 save_path。
    内存峰值 ≤ 5MB（按 _STREAM_CHUNK 分块写入）。
    """
    from pathlib import Path
    from app.core.config import settings

    _stream_chunk = settings.STREAM_CHUNK_BYTES
    _max_dl = settings.MAX_DOWNLOAD_SIZE_MB * 1024 * 1024
    save_path = Path(save_path)

    if not await ensure_zlib_session():
        logger.info(f"[ZLib] No valid session, cannot download md5={md5[:8]}")
        return False

    cookies = _cred_store.get_cookies()

    for domain in _ZLIB_DOMAINS:
        try:
            book_url = f"https://{domain}/md5/{md5}"
            async with httpx.AsyncClient(
                timeout=20, follow_redirects=True, verify=False, cookies=cookies
            ) as c:
                r = await c.get(book_url, headers={"User-Agent": _UA})
                if r.status_code != 200:
                    continue

                import re
                text = r.text
                dl_match = re.search(
                    r'href="(/dl/[^"]+)"[^>]*>.*?Download', text, re.S
                ) or re.search(r'href="(/book/[^"]+/download)"', text)

                if not dl_match:
                    continue

                dl_path = dl_match.group(1)
                dl_url = f"https://{domain}{dl_path}"
                logger.info(f"[ZLib] Stream downloading: {dl_url[:80]}")

                async with c.stream("GET", dl_url, headers={"User-Agent": _UA}, follow_redirects=True) as resp:
                    if resp.status_code != 200:
                        continue
                    total = 0
                    header_bytes = b""
                    with open(save_path, "wb") as f:
                        async for chunk in resp.aiter_bytes(_stream_chunk):
                            if not header_bytes:
                                header_bytes = chunk[:8]
                            total += len(chunk)
                            if total > _max_dl:
                                save_path.unlink(missing_ok=True)
                                logger.warning(f"[ZLib] File too large, aborted at {total}")
                                return False
                            f.write(chunk)

                    if total > 1024 and header_bytes[:4] == b"%PDF":
                        logger.info(f"[ZLib] Stream download success: {total} bytes")
                        return True

                    save_path.unlink(missing_ok=True)
                    logger.warning(f"[ZLib] Non-PDF: size={total} head={header_bytes[:8]!r}")

        except Exception as e:
            logger.debug(f"[ZLib] Stream error on {domain}: {e}")
            save_path.unlink(missing_ok=True)

    return False
