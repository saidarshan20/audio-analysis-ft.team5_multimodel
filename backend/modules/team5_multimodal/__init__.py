# modules/team5_multimodal/__init__.py

import os
import ssl
import sys

# ──── torchcodec DLL suppression ─────────────────────────────────
# torchcodec raises OSError (not ImportError) when its native DLL
# cannot be loaded (e.g. missing VC++ redist, mismatched CUDA).
# transformers' is_torchcodec_available() only catches ImportError,
# so the OSError propagates and crashes startup when this module is
# imported.  We pre-attempt the import here, swallow the failure,
# and install a None sentinel so subsequent `import torchcodec`
# calls raise a clean ModuleNotFoundError (a subclass of ImportError)
# that transformers DOES catch — making it correctly report the codec
# as unavailable instead of crashing.
if "torchcodec" not in sys.modules:
    try:
        import torchcodec  # noqa: F401
    except (ImportError, OSError, Exception):
        sys.modules["torchcodec"] = None  # type: ignore[assignment]

# ──── SSL Certificate Fix ────────────────────────────────────────
# Fixes: [SSL: CERTIFICATE_VERIFY_FAILED] on Windows / fresh installs
# when downloading HuggingFace models (CLIP, BLIP, etc.)

try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
except ImportError:
    ssl._create_default_https_context = ssl._create_unverified_context
