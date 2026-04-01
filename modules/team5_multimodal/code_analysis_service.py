"""
code_analysis_service.py  –  2-pass LLM code analysis for Team 5 Multimodal.

Pass 1: File tree → architecture (components + connections)
Pass 2: Key source files → detailed analysis (key functions + system flow)
"""

import io
import json
import logging
import os
import tempfile
import zipfile
from pathlib import Path

from groq import AsyncGroq

from modules.team5_multimodal.config import get_settings
from modules.team5_multimodal.models import CodeArchResult, CodeDetailResult

logger = logging.getLogger(__name__)

# ── Directories / extensions to skip when building the file tree ──
SKIP_DIRS = {
    "__pycache__", ".git", ".svn", ".hg", "node_modules", ".venv", "venv",
    "env", ".tox", ".mypy_cache", ".pytest_cache", "dist", "build",
    ".next", ".nuxt", ".idea", ".vscode", "__MACOSX",
}

# Extensions we consider "source code" for Pass 2
SOURCE_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".go", ".rs",
    ".c", ".cpp", ".h", ".hpp", ".rb", ".php", ".swift", ".kt",
    ".scala", ".cs", ".html", ".css", ".scss", ".vue", ".svelte",
}

# Config / metadata files worth reading
CONFIG_FILES = {
    "package.json", "requirements.txt", "pyproject.toml", "setup.py",
    "Dockerfile", "docker-compose.yml", "Makefile", ".env.example",
    "tsconfig.json", "vite.config.ts", "next.config.js", "cargo.toml",
}

MAX_FILE_LINES = 500        # cap per file for Pass 2
MAX_IMPORTANT_FILES = 15    # how many files to send in Pass 2
MAX_FILE_SIZE_BYTES = 50_000  # skip very large files


# ─────────────────── Prompts ───────────────────

ARCH_SYSTEM_PROMPT = """You are a senior software architect.

Your task is to analyze a codebase FILE TREE and produce a clean, minimal architectural understanding of the system.

IMPORTANT RULES:
- Do NOT guess technologies not present in file names.
- Do NOT invent files, components, or connections.
- Keep architecture SIMPLE and MEANINGFUL (max 12 components).
- Group related files into logical components.
- Prefer clarity over completeness.

OUTPUT:
Return ONLY valid JSON. No explanations. No markdown.

SCHEMA:
{
  "title": "string",
  "summary": "2-3 sentence high-level description of the project",
  "components": [
    {
      "id": "string",
      "name": "string",
      "type": "frontend | backend | api | database | service | config | other",
      "description": "what this component does",
      "files": ["file_path1", "file_path2"]
    }
  ],
  "connections": [
    {
      "source": "component_id",
      "target": "component_id",
      "type": "import | api_call | data_flow | config",
      "description": "short explanation of relationship"
    }
  ]
}

GUIDELINES:
- Identify entry points (e.g., main.py, index.js, app.tsx).
- Group files into components based on folder structure and naming.
- Only include meaningful connections (avoid noise).
- If unsure, omit rather than hallucinate.
- Keep descriptions concise and technical."""

DETAIL_SYSTEM_PROMPT = """You are a senior software engineer explaining a codebase to another engineer.

Your task is to analyze selected IMPORTANT FILES and produce concise, accurate insights.

IMPORTANT RULES:
- Do NOT hallucinate functionality not visible in code.
- Do NOT explain trivial code.
- Focus only on important logic and purpose.
- Keep output concise and structured.

OUTPUT:
Return ONLY valid JSON. No explanations. No markdown.

SCHEMA:
{
  "key_files": [
    {
      "file_path": "string",
      "summary": "what this file does in 1-2 sentences",
      "key_functions": [
        "function_name: short explanation"
      ]
    }
  ],
  "flow": [
    {
      "step": 1,
      "description": "step-by-step system flow (user → backend → db etc.)"
    }
  ]
}

GUIDELINES:
- Only include 5–10 most important files.
- Prioritize entry points and core logic files.
- Extract real function names if visible.
- Flow should reflect actual system behavior.
- Keep flow under 8 steps."""


# ─────────────────── Groq client ───────────────────

_groq_client: AsyncGroq | None = None


def _get_groq_client() -> AsyncGroq:
    global _groq_client
    if _groq_client is None:
        s = get_settings()
        _groq_client = AsyncGroq(api_key=s.groq_api_key)
    return _groq_client


# ─────────────────── Service ───────────────────

class CodeAnalysisService:
    def __init__(self) -> None:
        self._client: AsyncGroq = _get_groq_client()
        self._settings = get_settings()

    # ── ZIP extraction ──

    @staticmethod
    def extract_zip(zip_bytes: bytes) -> str:
        """Extract a ZIP archive into a temporary directory. Returns the root path."""
        tmp_dir = tempfile.mkdtemp(prefix="code_analysis_")
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            zf.extractall(tmp_dir)

        # If the ZIP has a single top-level folder, use that as root
        entries = [
            e for e in os.listdir(tmp_dir)
            if not e.startswith(".") and e not in SKIP_DIRS
        ]
        if len(entries) == 1:
            candidate = os.path.join(tmp_dir, entries[0])
            if os.path.isdir(candidate):
                return candidate
        return tmp_dir

    # ── File tree builder ──

    @staticmethod
    def build_file_tree(root_dir: str) -> str:
        """Walk the directory and return a text file-tree string."""
        root = Path(root_dir)
        lines: list[str] = []

        def _walk(directory: Path, prefix: str = "") -> None:
            children = sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
            children = [c for c in children if c.name not in SKIP_DIRS and not c.name.startswith(".")]
            for i, child in enumerate(children):
                is_last = i == len(children) - 1
                connector = "└── " if is_last else "├── "
                lines.append(f"{prefix}{connector}{child.name}")
                if child.is_dir():
                    extension = "    " if is_last else "│   "
                    _walk(child, prefix + extension)

        lines.append(root.name + "/")
        _walk(root)
        return "\n".join(lines)

    # ── Important file selector ──

    @staticmethod
    def select_important_files(root_dir: str) -> str:
        """Read key source files and return them as a formatted string."""
        root = Path(root_dir)
        selected: list[tuple[str, str]] = []  # (relative_path, content)

        for path in sorted(root.rglob("*")):
            if len(selected) >= MAX_IMPORTANT_FILES:
                break
            if not path.is_file():
                continue
            # Skip ignored dirs
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            # Skip large files
            try:
                if path.stat().st_size > MAX_FILE_SIZE_BYTES:
                    continue
            except OSError:
                continue

            rel = str(path.relative_to(root))

            # Include if source extension or config file
            if path.suffix.lower() in SOURCE_EXTENSIONS or path.name.lower() in CONFIG_FILES:
                try:
                    content = path.read_text(encoding="utf-8", errors="replace")
                    # Cap lines
                    content_lines = content.splitlines()
                    if len(content_lines) > MAX_FILE_LINES:
                        content = "\n".join(content_lines[:MAX_FILE_LINES]) + "\n... (truncated)"
                    selected.append((rel, content))
                except Exception:
                    continue

        # Format as snippets
        parts: list[str] = []
        for rel_path, content in selected:
            parts.append(f"### {rel_path}\n```\n{content}\n```\n")
        return "\n".join(parts)

    # ── LLM calls ──

    async def analyze_architecture(self, file_tree: str) -> CodeArchResult:
        """Pass 1: file tree → architecture JSON."""
        user_msg = f"FILE TREE:\n{file_tree}"
        response = await self._client.chat.completions.create(
            model=self._settings.groq_model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": ARCH_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.1,
        )
        raw = response.choices[0].message.content
        logger.debug("Arch LLM response: %s", raw)
        data = json.loads(raw)  # type: ignore[arg-type]
        return CodeArchResult.model_validate(data)

    async def analyze_files(
        self, arch_output: CodeArchResult, code_snippets: str
    ) -> CodeDetailResult:
        """Pass 2: architecture context + code snippets → detailed analysis JSON."""
        context = json.dumps(arch_output.model_dump(), indent=2)
        user_msg = f"CONTEXT:\n{context}\n\nFILES:\n{code_snippets}"
        response = await self._client.chat.completions.create(
            model=self._settings.groq_model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": DETAIL_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.1,
        )
        raw = response.choices[0].message.content
        logger.debug("Detail LLM response: %s", raw)
        data = json.loads(raw)  # type: ignore[arg-type]
        return CodeDetailResult.model_validate(data)
