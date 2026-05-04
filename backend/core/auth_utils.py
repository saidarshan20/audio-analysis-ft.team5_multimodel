import bcrypt
from jose import jwt
from datetime import datetime, timedelta

# --- JWT Configuration ---
SECRET_KEY = "ai_sphere_secret_key_change_me_later" 
ALGORITHM = "HS256"

# --- Password Hashing (Fixed Pure Bcrypt) ---
def hash_password(password: str) -> str:
    # Bcrypt needs passwords converted to bytes before hashing
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(pwd_bytes, salt)
    
    # Convert back to a normal string to save in SQLite DB
    return hashed_password.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    password_byte_enc = plain_password.encode('utf-8')
    hashed_password_byte_enc = hashed_password.encode('utf-8')
    
    # Check if they match
    return bcrypt.checkpw(password_byte_enc, hashed_password_byte_enc)

# --- Token Generation ---
def create_access_token(data: dict):
    to_encode = data.copy()
    # Token expires in 2 hours
    expire = datetime.utcnow() + timedelta(hours=2)
    to_encode.update({"exp": expire})
    
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt