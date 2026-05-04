# import os
# import urllib.parse
# from fastapi import APIRouter, HTTPException
# from fastapi.responses import StreamingResponse
# from azure.storage.blob import BlobServiceClient

# router = APIRouter(prefix="/api/blobs", tags=["Integration: Azure Blob Storage"])

# def get_blob_service_client():
#     account_name = os.getenv("AZURE_STORAGE_ACCOUNT_NAME")
#     account_key = os.getenv("AZURE_STORAGE_ACCOUNT_KEY")
#     if not account_name or not account_key:
#         raise HTTPException(status_code=500, detail="Azure Storage credentials missing in .env")
    
#     account_url = f"https://{account_name}.blob.core.windows.net"
#     return BlobServiceClient(account_url=account_url, credential=account_key)

# @router.get("/outputs")
# def list_team_outputs():
#     """Dynamically fetches all files inside the anonymization and feature eng folders."""
#     try:
#         blob_service_client = get_blob_service_client()
#         container_name = os.getenv("AZURE_BLOB_CONTAINER_NAME", "aikosh-v2")
#         container_client = blob_service_client.get_container_client(container_name)

#         # The specific folders you mentioned
#         target_folders = ["anonymization/", "feature eng/"]
#         results = []
        
#         for folder in target_folders:
#             # list_blobs with name_starts_with acts like a folder search
#             blobs = container_client.list_blobs(name_starts_with=folder)
            
#             for blob in blobs:
#                 # Skip the folder marker itself if Azure created one
#                 if blob.name == folder:
#                     continue
                    
#                 # Format file size for the UI
#                 size_kb = blob.size / 1024
#                 size_str = f"{size_kb / 1024:.2f} MB" if size_kb > 1024 else f"{size_kb:.0f} KB"

#                 # Clean the filename for display (remove the folder prefix)
#                 filename = blob.name.replace(folder, "")

#                 results.append({
#                     "id": blob.name, # Use full Azure path as a unique ID
#                     "filename": filename,
#                     "full_path": blob.name,
#                     "folder": folder.strip("/"), # 'anonymization' or 'feature eng'
#                     "size": size_str,
#                     "last_modified": blob.last_modified.strftime("%b %d, %Y %H:%M") if blob.last_modified else "Unknown"
#                 })
        
#         # Sort by most recently modified
#         results.sort(key=lambda x: x.get("last_modified"), reverse=True)
#         return {"datasets": results}

#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

# @router.get("/download")
# def download_blob(blob_path: str):
#     """Streams the requested file from Azure directly to the user."""
#     try:
#         blob_service_client = get_blob_service_client()
#         container_name = os.getenv("AZURE_BLOB_CONTAINER_NAME", "aikosh-v2")
#         blob_client = blob_service_client.get_blob_client(container=container_name, blob=blob_path)
        
#         if not blob_client.exists():
#             raise HTTPException(status_code=404, detail="File not found in blob storage.")

#         stream = blob_client.download_blob()
        
#         # Extract filename safely for download headers
#         filename = blob_path.split("/")[-1]
#         safe_filename = urllib.parse.quote(filename)

#         return StreamingResponse(
#             stream.chunks(),
#             media_type="application/octet-stream",
#             headers={"Content-Disposition": f"attachment; filename*=UTF-8''{safe_filename}"}
#         )
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))


# @router.get("/download-to-viz")
# def download_blob_to_viz(blob_path: str):
#     """Downloads a blob file and saves it to the team4 viz raw uploads directory for direct visualization."""
#     try:
#         blob_service_client = get_blob_service_client()
#         container_name = os.getenv("AZURE_BLOB_CONTAINER_NAME", "aikosh-v2")
#         blob_client = blob_service_client.get_blob_client(container=container_name, blob=blob_path)

#         if not blob_client.exists():
#             raise HTTPException(status_code=404, detail="File not found in blob storage.")

#         # Determine the raw uploads directory (same as team4 viz uses)
#         base_dir = os.path.dirname(os.path.abspath(__file__))
#         project_root = os.path.abspath(os.path.join(base_dir, ".."))
#         raw_data_dir = os.path.join(project_root, "shared_workspace", "1_raw_uploads")
#         os.makedirs(raw_data_dir, exist_ok=True)

#         # Extract filename and save
#         filename = blob_path.split("/")[-1]
#         dest_path = os.path.join(raw_data_dir, filename)

#         download_stream = blob_client.download_blob()
#         with open(dest_path, "wb") as f:
#             for chunk in download_stream.chunks():
#                 f.write(chunk)

#         return {"message": "File saved for visualization", "filename": filename}

#     except HTTPException:
#         raise
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))
import os
import shutil
import urllib.parse
from datetime import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from azure.storage.blob import BlobServiceClient

router = APIRouter(prefix="/api/blobs", tags=["Integration: Azure Blob Storage"])

def get_blob_service_client():
    account_name = os.getenv("AZURE_STORAGE_ACCOUNT_NAME")
    account_key = os.getenv("AZURE_STORAGE_ACCOUNT_KEY")
    
    # Changed from HTTPException to ValueError so we can catch it internally and trigger the local fallback
    if not account_name or not account_key:
        raise ValueError("Azure Storage credentials missing in .env")
    
    account_url = f"https://{account_name}.blob.core.windows.net"
    return BlobServiceClient(account_url=account_url, credential=account_key)

@router.get("/outputs")
def list_team_outputs():
    """Dynamically fetches all files. Tries Azure first, falls back to local folders."""
    target_folders =["anonymization", "feature eng"] # Removed slash for easier local mapping
    results =[]
    
    try:
        blob_service_client = get_blob_service_client()
        container_name = os.getenv("AZURE_BLOB_CONTAINER_NAME", "aikosh-v2")
        container_client = blob_service_client.get_container_client(container_name)

        for folder in target_folders:
            azure_folder = f"{folder}/"
            blobs = container_client.list_blobs(name_starts_with=azure_folder)
            
            for blob in blobs:
                if blob.name == azure_folder:
                    continue
                    
                size_kb = blob.size / 1024
                size_str = f"{size_kb / 1024:.2f} MB" if size_kb > 1024 else f"{size_kb:.0f} KB"
                filename = blob.name.replace(azure_folder, "")

                results.append({
                    "id": blob.name,
                    "filename": filename,
                    "full_path": blob.name,
                    "folder": folder,
                    "size": size_str,
                    "last_modified": blob.last_modified.strftime("%b %d, %Y %H:%M") if blob.last_modified else "Unknown"
                })
                
        results.sort(key=lambda x: x.get("last_modified", ""), reverse=True)
        return {"datasets": results}

    except Exception as e:
        print(f"⚠️ Azure Blob Storage unavailable, falling back to local directories: {e}")
        
        # --- LOCAL DIRECTORY FALLBACK ---
        base_dir = os.path.dirname(os.path.abspath(__file__))
        
        for folder in target_folders:
            local_folder_path = os.path.join(base_dir, folder)
            
            if os.path.exists(local_folder_path) and os.path.isdir(local_folder_path):
                for filename in os.listdir(local_folder_path):
                    file_path = os.path.join(local_folder_path, filename)
                    
                    if os.path.isfile(file_path):
                        size_kb = os.path.getsize(file_path) / 1024
                        size_str = f"{size_kb / 1024:.2f} MB" if size_kb > 1024 else f"{size_kb:.0f} KB"
                        
                        # Mock the Azure path format (folder/filename)
                        fake_blob_name = f"{folder}/{filename}"
                        last_modified_time = os.path.getmtime(file_path)
                        dt = datetime.fromtimestamp(last_modified_time)

                        results.append({
                            "id": fake_blob_name,
                            "filename": filename,
                            "full_path": fake_blob_name,
                            "folder": folder,
                            "size": size_str,
                            "last_modified": dt.strftime("%b %d, %Y %H:%M")
                        })
        
        results.sort(key=lambda x: x.get("last_modified", ""), reverse=True)
        return {"datasets": results}

@router.get("/download")
def download_blob(blob_path: str):
    """Streams the requested file from Azure, falls back to local file if Azure fails."""
    try:
        blob_service_client = get_blob_service_client()
        container_name = os.getenv("AZURE_BLOB_CONTAINER_NAME", "aikosh-v2")
        blob_client = blob_service_client.get_blob_client(container=container_name, blob=blob_path)
        
        if not blob_client.exists():
            raise ValueError("File not found in blob storage.")

        stream = blob_client.download_blob()
        filename = blob_path.split("/")[-1]
        safe_filename = urllib.parse.quote(filename)

        return StreamingResponse(
            stream.chunks(),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{safe_filename}"}
        )
        
    except Exception as e:
        print(f"⚠️ Azure Download failed, checking local storage: {e}")
        
        # --- LOCAL DIRECTORY FALLBACK ---
        base_dir = os.path.dirname(os.path.abspath(__file__))
        
        # blob_path looks like "anonymization/my_file.csv"
        # We split it and unpack into os.path.join to securely build the path
        local_file_path = os.path.join(base_dir, *blob_path.split("/"))
        
        if not os.path.exists(local_file_path) or not os.path.isfile(local_file_path):
            raise HTTPException(status_code=404, detail="File not found locally or in Azure.")
            
        filename = os.path.basename(local_file_path)
        safe_filename = urllib.parse.quote(filename)
        
        return FileResponse(
            path=local_file_path,
            media_type="application/octet-stream",
            filename=filename,
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{safe_filename}"}
        )

@router.get("/download-to-viz")
def download_blob_to_viz(blob_path: str):
    """Downloads a blob file to the team4 viz raw uploads directory, falls back to local file copy."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(base_dir, ".."))
    raw_data_dir = os.path.join(project_root, "shared_workspace", "1_raw_uploads")
    os.makedirs(raw_data_dir, exist_ok=True)
    
    filename = blob_path.split("/")[-1]
    dest_path = os.path.join(raw_data_dir, filename)

    try:
        blob_service_client = get_blob_service_client()
        container_name = os.getenv("AZURE_BLOB_CONTAINER_NAME", "aikosh-v2")
        blob_client = blob_service_client.get_blob_client(container=container_name, blob=blob_path)

        if not blob_client.exists():
            raise ValueError("File not found in blob storage.")

        download_stream = blob_client.download_blob()
        with open(dest_path, "wb") as f:
            for chunk in download_stream.chunks():
                f.write(chunk)

        return {"message": "File saved for visualization", "filename": filename}

    except Exception as e:
        print(f"⚠️ Azure Download-to-Viz failed, attempting local copy: {e}")
        
        # --- LOCAL DIRECTORY FALLBACK ---
        local_file_path = os.path.join(base_dir, *blob_path.split("/"))
        
        if not os.path.exists(local_file_path) or not os.path.isfile(local_file_path):
            raise HTTPException(status_code=404, detail="File not found locally or in Azure.")
            
        # Instead of streaming, just copy the local file into the viz workspace folder
        shutil.copy2(local_file_path, dest_path)
        
        return {"message": "Local file copied for visualization", "filename": filename}