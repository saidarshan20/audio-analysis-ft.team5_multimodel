"""
auth_router.py  –  Signup & Login API endpoints.
"""

import sqlite3

from fastapi import APIRouter, HTTPException

from core.core_db import get_connection
from core.core_models import UserCreate, UserLogin, Token, UserOut
from core.auth_utils import hash_password, verify_password, create_access_token

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/signup", response_model=UserOut, status_code=201)
def signup(user: UserCreate):
    """Register a new user."""
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO users (username, email, hashed_pwd) VALUES (?, ?, ?)",
            (user.username, user.email, hash_password(user.password)),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, username, email FROM users WHERE email = ?", (user.email,)
        ).fetchone()
        return UserOut(id=row["id"], username=row["username"], email=row["email"])
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Username or email already exists.")
    finally:
        conn.close()


@router.post("/login", response_model=Token)
def login(credentials: UserLogin):
    """Authenticate and return a JWT."""
    conn = get_connection()
    row = conn.execute(
        "SELECT id, username, email, hashed_pwd FROM users WHERE email = ?",
        (credentials.email,),
    ).fetchone()
    conn.close()

    if not row or not verify_password(credentials.password, row["hashed_pwd"]):
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    token = create_access_token({"sub": str(row["id"]), "email": row["email"]})
    return Token(access_token=token)
