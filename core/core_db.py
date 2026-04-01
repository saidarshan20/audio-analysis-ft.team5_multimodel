"""
core_db.py  –  SQLite connection helper for the shared users database (core.db).
Used exclusively by the Integration Team's auth system.
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "core.db")


def get_connection() -> sqlite3.Connection:
    """Return a connection to the core SQLite database."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_db() -> None:
    """Create the users table if it doesn't exist."""
    conn = get_connection()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            username   TEXT    UNIQUE NOT NULL,
            email      TEXT    UNIQUE NOT NULL,
            hashed_pwd TEXT    NOT NULL,
            created_at TEXT    DEFAULT (datetime('now'))
        );
        """
    )
    conn.commit()
    conn.close()
