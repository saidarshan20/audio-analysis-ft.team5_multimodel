"""
audit_db.py - Audit Logging Database Setup

This file manages the database connection and operations for audit logging.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import os

# Create database in the team2_feature_eng module directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) # Point to team2_feature_eng folder
AUDIT_DB_URL = f"sqlite:///{os.path.join(BASE_DIR, 'audit_logs.db')}"

# Create engine and session
audit_engine = create_engine(AUDIT_DB_URL, connect_args={"check_same_thread": False})
AuditSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=audit_engine)


def get_audit_db():
    """Dependency for getting audit database session"""
    db = AuditSessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_audit_db():
    """Initialize the audit log database tables"""
    from .audit_models import Base
    Base.metadata.create_all(bind=audit_engine)
