# modules/team5_multimodal/__init__.py

# ──── SSL Certificate Fix ────────────────────────────────────────
# Fixes: [SSL: CERTIFICATE_VERIFY_FAILED] on Windows / fresh installs
# when downloading HuggingFace models (CLIP, BLIP, etc.)
import os
import ssl

try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
except ImportError:
    ssl._create_default_https_context = ssl._create_unverified_context
