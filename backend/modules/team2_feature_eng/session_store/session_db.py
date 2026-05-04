"""
session_db.py - Session Database Setup

Self-contained SQLite database for workflow session persistence.
The database file is stored at: modules/team2_feature_eng/session/session.db
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import os

# Database lives inside the session/ package directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SESSION_DB_URL = f"sqlite:///{os.path.join(BASE_DIR, 'session.db')}"

# Create engine and session factory
session_engine = create_engine(SESSION_DB_URL, connect_args={"check_same_thread": False})
SessionDBLocal = sessionmaker(autocommit=False, autoflush=False, bind=session_engine)


def get_session_db():
    """Dependency for getting a session database connection."""
    db = SessionDBLocal()
    try:
        yield db
    finally:
        db.close()


def init_session_db():
    """Initialize the session database tables."""
    from .session_models import Base
    Base.metadata.create_all(bind=session_engine)
