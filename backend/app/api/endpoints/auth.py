from datetime import datetime, timezone
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserProfile
from app.schemas.common import ApiResponse

router = APIRouter(prefix="/auth", tags=["认证"])


@router.post("/register", response_model=ApiResponse[TokenResponse])
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    conditions = [User.username == req.username]
    if req.email:
        conditions.append(User.email == req.email)
    if req.phone:
        conditions.append(User.phone == req.phone)

    existing = await db.execute(select(User).where(or_(*conditions)))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名、邮箱或手机号已存在")

    user = User(
        username=req.username,
        email=req.email,
        phone=req.phone,
        password_hash=hash_password(req.password),
    )
    db.add(user)
    await db.flush()

    token = create_access_token({"sub": str(user.id)})
    return ApiResponse.ok(data=TokenResponse(access_token=token))


@router.post("/login", response_model=ApiResponse[TokenResponse])
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(User).where(
            or_(
                User.username == req.account,
                User.email == req.account,
                User.phone == req.account,
            )
        )
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="该账号尚未注册，请先创建账号",
        )
    if not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密码错误，请重试",
        )

    user.last_login = datetime.now(timezone.utc)
    token = create_access_token({"sub": str(user.id)})
    return ApiResponse.ok(data=TokenResponse(access_token=token))


@router.get("/me", response_model=ApiResponse[UserProfile])
async def get_me(user: User = Depends(get_current_user)):
    return ApiResponse.ok(data=UserProfile.model_validate(user))


# ---------------------------------------------------------------------------
# OAuth: 微信扫码登录
# ---------------------------------------------------------------------------

WECHAT_AUTH_URL = "https://open.weixin.qq.com/connect/qrconnect"
WECHAT_TOKEN_URL = "https://api.weixin.qq.com/sns/oauth2/access_token"
WECHAT_USERINFO_URL = "https://api.weixin.qq.com/sns/userinfo"


@router.get("/oauth/wechat")
async def wechat_oauth_redirect():
    """生成微信扫码登录链接并重定向"""
    if not settings.WECHAT_APP_ID:
        raise HTTPException(status_code=501, detail="微信登录暂未配置")
    params = {
        "appid": settings.WECHAT_APP_ID,
        "redirect_uri": settings.WECHAT_REDIRECT_URI,
        "response_type": "code",
        "scope": "snsapi_login",
        "state": "aicoacher_wechat",
    }
    return RedirectResponse(f"{WECHAT_AUTH_URL}?{urlencode(params)}#wechat_redirect")


@router.get("/oauth/wechat/callback", response_model=ApiResponse[TokenResponse])
async def wechat_oauth_callback(
    code: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """微信扫码回调：用 code 换取用户信息并登录/注册"""
    async with httpx.AsyncClient(timeout=10) as client:
        token_resp = await client.get(WECHAT_TOKEN_URL, params={
            "appid": settings.WECHAT_APP_ID,
            "secret": settings.WECHAT_APP_SECRET,
            "code": code,
            "grant_type": "authorization_code",
        })
        token_data = token_resp.json()
        if "errcode" in token_data:
            raise HTTPException(status_code=400, detail=f"微信授权失败: {token_data.get('errmsg')}")

        openid = token_data["openid"]
        access_token = token_data["access_token"]

        info_resp = await client.get(WECHAT_USERINFO_URL, params={
            "access_token": access_token,
            "openid": openid,
        })
        info = info_resp.json()

    result = await db.execute(select(User).where(User.wechat_openid == openid))
    user = result.scalar_one_or_none()

    if not user:
        user = User(
            username=f"wx_{openid[:8]}",
            wechat_openid=openid,
            avatar_url=info.get("headimgurl"),
            password_hash="",
        )
        db.add(user)
        await db.flush()

    user.last_login = datetime.now(timezone.utc)
    jwt_token = create_access_token({"sub": str(user.id)})
    return ApiResponse.ok(data=TokenResponse(access_token=jwt_token))


# ---------------------------------------------------------------------------
# OAuth: 支付宝扫码登录
# ---------------------------------------------------------------------------

ALIPAY_AUTH_URL = "https://openauth.alipay.com/oauth2/publicAppAuthorize.htm"
ALIPAY_TOKEN_URL = "https://openapi.alipay.com/gateway.do"


@router.get("/oauth/alipay")
async def alipay_oauth_redirect():
    """生成支付宝扫码登录链接并重定向"""
    if not settings.ALIPAY_APP_ID:
        raise HTTPException(status_code=501, detail="支付宝登录暂未配置")
    params = {
        "app_id": settings.ALIPAY_APP_ID,
        "redirect_uri": settings.ALIPAY_REDIRECT_URI,
        "scope": "auth_user",
        "state": "aicoacher_alipay",
    }
    return RedirectResponse(f"{ALIPAY_AUTH_URL}?{urlencode(params)}")


@router.get("/oauth/alipay/callback", response_model=ApiResponse[TokenResponse])
async def alipay_oauth_callback(
    auth_code: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """支付宝扫码回调：用 auth_code 换取用户信息并登录/注册"""
    if not settings.ALIPAY_APP_ID:
        raise HTTPException(status_code=501, detail="支付宝登录暂未配置")

    async with httpx.AsyncClient(timeout=10) as client:
        token_resp = await client.get(ALIPAY_TOKEN_URL, params={
            "app_id": settings.ALIPAY_APP_ID,
            "method": "alipay.system.oauth.token",
            "grant_type": "authorization_code",
            "code": auth_code,
            "charset": "utf-8",
            "sign_type": "RSA2",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "version": "1.0",
        })
        token_data = token_resp.json()
        resp_body = token_data.get("alipay_system_oauth_token_response", {})
        if "error_response" in token_data:
            raise HTTPException(status_code=400, detail="支付宝授权失败")

        alipay_uid = resp_body.get("user_id", "")
        if not alipay_uid:
            raise HTTPException(status_code=400, detail="未获取到支付宝用户ID")

    result = await db.execute(select(User).where(User.alipay_openid == alipay_uid))
    user = result.scalar_one_or_none()

    if not user:
        user = User(
            username=f"alipay_{alipay_uid[:8]}",
            alipay_openid=alipay_uid,
            password_hash="",
        )
        db.add(user)
        await db.flush()

    user.last_login = datetime.now(timezone.utc)
    jwt_token = create_access_token({"sub": str(user.id)})
    return ApiResponse.ok(data=TokenResponse(access_token=jwt_token))
