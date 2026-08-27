"""Entry point: `python run.py` starts FastAPI on :8000."""
import os
import sys

if sys.platform.startswith("win"):
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

import uvicorn

if __name__ == "__main__":
    print()
    print("  GolfAdmin API  —  http://127.0.0.1:8000")
    print("  Docs          —  http://127.0.0.1:8000/docs")
    print("  Demo logins   :  admin/admin, manager/manager (dev only, must_change_password=True)")
    print()
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
