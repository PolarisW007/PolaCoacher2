from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserProfile
from app.schemas.common import ApiResponse

router = APIRouter(prefix="/auth", tags=["认证"])


@router.post("/register", response_model=ApiResponse[TokenResponse])
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        select(User).where(
            or_(
                User.username == req.username,
                User.email == req.email if req.email else False,
                User.phone == req.phone if req.phone else False,
            )
        )
    )
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
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码错误")

    user.last_login = datetime.now(timezone.utc)
    token = create_access_token({"sub": str(user.id)})
    return ApiResponse.ok(data=TokenResponse(access_token=token))


@router.get("/me", response_model=ApiResponse[UserProfile])
async def get_me(user: User = Depends(get_current_user)):
    return ApiResponse.ok(data=UserProfile.model_validate(user))
