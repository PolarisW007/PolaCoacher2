from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=6, max_length=128)
    email: EmailStr | None = None
    phone: str | None = None


class LoginRequest(BaseModel):
    account: str = Field(description="用户名、邮箱或手机号")
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserProfile(BaseModel):
    id: int
    username: str
    email: str | None = None
    phone: str | None = None
    avatar_url: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
