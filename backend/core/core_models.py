from sqlalchemy import Column, Integer, String
from .core_db import Base
from pydantic import BaseModel

# --- SQLALCHEMY TABLE ---
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)

# --- PYDANTIC SCHEMAS (For API Validation) ---
class UserCreate(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str