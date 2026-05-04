from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from . import core_db, core_models, auth_utils

router = APIRouter(prefix="/api/auth", tags=["Integration: Auth"])

# Auto-create the core.db tables
core_models.Base.metadata.create_all(bind=core_db.engine)

@router.post("/signup")
def signup(user: core_models.UserCreate, db: Session = Depends(core_db.get_db)):
    existing_user = db.query(core_models.User).filter(core_models.User.username == user.username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="User exists")
    
    new_user = core_models.User(
        username=user.username, 
        password_hash=auth_utils.hash_password(user.password)
    )
    db.add(new_user)
    db.commit()
    return {"message": "Signup successful"}

@router.post("/login", response_model=core_models.Token)
def login(user: core_models.UserCreate, db: Session = Depends(core_db.get_db)):
    db_user = db.query(core_models.User).filter(core_models.User.username == user.username).first()
    if not db_user or not auth_utils.verify_password(user.password, db_user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = auth_utils.create_access_token({"sub": db_user.username})
    return {"access_token": token, "token_type": "bearer"}