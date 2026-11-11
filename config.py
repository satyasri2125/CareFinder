"""
config.py - all settings in one place.
Change the MySQL values below (or set them as environment variables)
so Flask can connect to your database.
"""
import os


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "change-this-secret-key")

    # ---- MySQL connection ----
    MYSQL_HOST = os.environ.get("MYSQL_HOST", "localhost")
    MYSQL_USER = os.environ.get("MYSQL_USER", "root")
    MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD", "")
    MYSQL_DB = os.environ.get("MYSQL_DB", "carefinder")
    MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
    MYSQL_SSL_CA = os.environ.get("MYSQL_SSL_CA", "")

    # Hospital staff must type this code when they register (change it for real use)
    STAFF_CODE = os.environ.get("STAFF_CODE", "CARE-STAFF-2026")
