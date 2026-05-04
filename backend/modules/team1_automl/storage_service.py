from .config import STORAGE_MODE


def get_storage():
    if STORAGE_MODE == "azure":
        from .storage_azure import AzureStorage
        return AzureStorage()
    else:
        from .storage_local import LocalStorage
        return LocalStorage()
