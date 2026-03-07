from typing import Any, Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    code: int = 0
    msg: str = "success"
    data: T | None = None

    @classmethod
    def ok(cls, data: Any = None, msg: str = "success") -> "ApiResponse":
        return cls(code=0, msg=msg, data=data)

    @classmethod
    def error(cls, code: int = 400, msg: str = "error") -> "ApiResponse":
        return cls(code=code, msg=msg, data=None)


class PaginatedData(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int
