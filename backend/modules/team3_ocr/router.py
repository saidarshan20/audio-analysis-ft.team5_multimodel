import importlib
import pkgutil
from fastapi import APIRouter

from .config import settings

router = APIRouter(prefix="/team3_ocr", tags=["Team 3 - OCR"])

def _include_dynamic_routes() -> None:
    """
    Dynamically discover and mount all sub-routers under `modules.team3_ocr.api.routes`.

    - `health` is mounted at `/team3_ocr/health` (no version prefix) for backwards compatibility.
    - All other routes are mounted under `/team3_ocr{settings.api_prefix}/...` (e.g. `/team3_ocr/api/v1/...`).
    """
    routes_pkg = importlib.import_module("modules.team3_ocr.api.routes")

    module_names = sorted(
        m.name for m in pkgutil.iter_modules(routes_pkg.__path__, routes_pkg.__name__ + ".")
    )
    for module_name in module_names:
        module = importlib.import_module(module_name)
        subrouter = getattr(module, "router", None)
        if not isinstance(subrouter, APIRouter):
            continue

        if module_name.endswith(".health"):
            router.include_router(subrouter, include_in_schema=True)
            continue

        if module_name.endswith(".unified"):
            router.include_router(subrouter, prefix=settings.api_prefix, include_in_schema=True)
            continue

        router.include_router(
            subrouter,
            prefix=settings.api_prefix,
            include_in_schema=settings.expose_detailed_endpoints,
        )


_include_dynamic_routes()
