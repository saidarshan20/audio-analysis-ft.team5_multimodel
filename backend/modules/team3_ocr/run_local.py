import sys
import os
import uvicorn
from fastapi import FastAPI

# This line ensures imports work perfectly when they test locally
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from modules.team3_ocr.router  import router

app = FastAPI(title="Team 3 Local Sandbox")
app.include_router(router)

if __name__ == "__main__":
    print("Starting Team 3 Local Server on port 8093...")
    uvicorn.run(app, host="127.0.0.1", port=8093)