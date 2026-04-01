"""
auth_utils.py  –  Password hashing (bcrypt) and JWT token helpers.
"""

import os
from datetime import datetime, timedelta, timezone
from hashlib import sha256

from jose import jwt, JWTError

# --------------- config ---------------
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-me-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60


# --------------- password helpers ---------------
def hash_password(password: str) -> str:
    """Simple SHA-256 hash (swap for bcrypt/passlib in production)."""
    return sha256(password.encode()).hexdigest()


def verify_password(plain: str, hashed: str) -> bool:
    return hash_password(plain) == hashed


# --------------- JWT helpers ---------------
def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
