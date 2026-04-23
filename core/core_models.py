"""
core_models.py  –  Pydantic schemas for authentication.
"""

from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str
    email: str
    password: str


class UserLogin(BaseModel):
    identifier: str | None = None
    email: str | None = None
    username: str | None = None
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    username: str
    email: str
