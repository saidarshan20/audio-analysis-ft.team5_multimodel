import os
import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api/kaggle", tags=["Kaggle Hub"])

def get_auth_kwargs():
    """Helper to get auth params for Kaggle requests."""
    token = os.environ.get("KAGGLE_API_TOKEN")
    if token:
        # As per kaggle token docs, authorization can often be passed as Bearer
        # For Kaggle's native basic auth fallback:
        return {"headers": {"Authorization": f"Bearer {token}"}}
    
    username = os.environ.get("KAGGLE_USERNAME")
    key = os.environ.get("KAGGLE_KEY")
    if username and key:
        return {"auth": (username, key)}
        
    raise HTTPException(status_code=500, detail="KAGGLE_API_TOKEN is not set in backend .env file")

@router.get("/datasets/browse")
def browse_datasets(
    search: str = "", 
    page: int = 1,
    sort_by: str = "hottest",
    file_type: str = "all"
):
    """Fetch datasets list from Kaggle with stable parameters."""
    url = "https://www.kaggle.com/api/v1/datasets/list"
    # Endpoints defaults to public, but we enforce it here clearly.
    # Using camelCase as per official Kaggle REST API expectations
    params = {
        "page": page, 
        "group": "public",
        "sortBy": sort_by
    }
    
    if search:
        params["search"] = search
    if file_type and file_type != "all":
        params["fileType"] = file_type
        
    auth_kwargs = get_auth_kwargs()

    try:
        response = requests.get(url, params=params, **auth_kwargs, timeout=15.0)
        response.raise_for_status()
        return {"datasets": response.json(), "page": page}
    except requests.exceptions.RequestException as e:
        status_code = e.response.status_code if e.response else 500
        raise HTTPException(status_code=status_code, detail=f"Failed to fetch from Kaggle: {str(e)}")

@router.get("/datasets/download/{owner}/{dataset_name}")
def download_dataset(owner: str, dataset_name: str):
    """Stream dataset ZIP from Kaggle directly to the client browser."""
    url = f"https://www.kaggle.com/api/v1/datasets/download/{owner}/{dataset_name}"
    auth_kwargs = get_auth_kwargs()

    try:
        # stream=True ensures we don't load the file into server RAM
        response = requests.get(url, stream=True, **auth_kwargs)
        
        if response.status_code != 200:
             raise HTTPException(status_code=response.status_code, detail="Failed to fetch download from Kaggle.")

        # Default filename
        file_name = f"{dataset_name}.zip"
        
        return StreamingResponse(
            response.iter_content(chunk_size=1024 * 1024),
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={file_name}"}
        )
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=str(e))
