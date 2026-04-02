import asyncio
import io
import zipfile
from httpx import AsyncClient, ASGITransport
from fastapi import FastAPI
from modules.team5_multimodal.router import router

app = FastAPI()
app.include_router(router)

def create_mock_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("main.py", "import utils\nclass Main:\n  def __init__(self): pass\ndef main(): utils.do_something()\nmain()")
        zf.writestr("utils.py", "def do_something(): print('hi')")
    return buf.getvalue()

async def test_endpoint():
    zip_bytes = create_mock_zip()
    print("Testing /team5/code-analyze endpoint...")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post(
            "/team5/code-analyze",
            files={"file": ("test_code.zip", zip_bytes, "application/zip")}
        )
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        print("Success! JSON payload:")
        print(response.json())
    else:
        print("Error details:", response.text)

if __name__ == "__main__":
    asyncio.run(test_endpoint())
