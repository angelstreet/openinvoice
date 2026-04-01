"""Add observability columns to documents table (idempotent)."""
import sys
sys.path.insert(0, "..")

from db.database import engine
from sqlalchemy import text

COLUMNS = [
    "ALTER TABLE documents ADD COLUMN pipeline_meta JSON",
    "ALTER TABLE documents ADD COLUMN corrected_fields JSON",
    "ALTER TABLE documents ADD COLUMN human_feedback JSON",
    "ALTER TABLE documents ADD COLUMN ai_feedback JSON",
]

with engine.connect() as conn:
    for sql in COLUMNS:
        col = sql.split("ADD COLUMN ")[1].split(" ")[0]
        try:
            conn.execute(text(sql))
            print(f"  Added: {col}")
        except Exception as e:
            if "duplicate column" in str(e).lower():
                print(f"  Exists: {col}")
            else:
                print(f"  Skip {col}: {e}")
    conn.commit()
    print("Done.")
