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

from openai import AsyncOpenAI

from modules.team5_multimodal.config import get_settings
from modules.team5_multimodal.models import CodeArchResult, CodeDetailResult

logger = logging.getLogger(__name__)

# ── Directories / extensions to skip when building the file tree ──
SKIP_DIRS = {
    "__pycache__", ".git", ".svn", ".hg", "node_modules", ".venv", "venv",
    "env", ".tox", ".mypy_cache", ".pytest_cache", "dist", "build",
    ".next", ".nuxt", ".idea", ".vscode", "__MACOSX",
    "docs", "tests", "scripts", "examples", "benchmarks", "site", "test"
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

MAX_FILE_LINES = 250        # cap per file for Pass 2 (NVIDIA benefit)
MAX_IMPORTANT_FILES = 15     # how many files to send in Pass 2 (NVIDIA benefit)
MAX_FILE_SIZE_BYTES = 25_000  # allow slightly larger files


# ─────────────────── Prompts ───────────────────

ARCH_SYSTEM_PROMPT = """You are a senior software architect.

Your task is to analyze an AST DEPENDENCY GRAPH representing codebase files and functions to produce a clean, semantic architectural map.

IMPORTANT RULES:
- Identify **Architectural Layers** (Presentation, Application, Domain, Infrastructure, or Cross-cutting).
- Detect **Design Patterns** present in the structure (e.g., Factory, Singleton, Observer, Middleware, Dependency Injection).
- Group related files into logical components.
- Keep architecture MEANINGFUL (max 15 components).
- Return ONLY valid JSON.

SCHEMA:
{
  "title": "string",
  "summary": "2-3 sentence high-level description",
  "detected_patterns": ["Pattern Name 1", "Pattern Name 2"],
  "components": [
    {
      "id": "string",
      "name": "string",
      "type": "frontend | backend | api | database | service | config | other",
      "layer": "presentation | application | domain | infrastructure | other",
      "description": "2-sentence technical role of this component",
      "files": ["file_path"]
    }
  ],
  "connections": [
    {
      "source": "component_id",
      "target": "component_id",
      "type": "import | api_call | data_flow | config",
      "description": "how they interact"
    }
  ]
}

LAYER DEFINITIONS:
- **Presentation**: UI, Controllers, Routes, Templates.
- **Application**: Use Cases, Services, Orchestrators.
- **Domain**: Entities, Models, Business Logic, Core Rules.
- **Infrastructure**: DB Drivers, External API Clients, Logging, Middleware.
- **Other**: Entry points, Configs, Scripts."""

DETAIL_SYSTEM_PROMPT = """You are a lead engineer explaining a codebase to a new architect.

Your task is to analyze the provided code snippets and the architecture context to explain HOW components interact and WHY specific logic exists.

IMPORTANT RULES:
- Focus on **Critical Paths**: Explain the lifecycle of a request or the core data transformation.
- Highlight **Technical Debt or Optimization** opportunities if seen.
- Explain component **Collaboration**: How does Component A use Component B?
- Keep output concise and strictly JSON.

SCHEMA:
{
  "key_files": [
    {
      "file_path": "string",
      "summary": "Deep insight into this file's role",
      "key_functions": ["func_name: detailed technical purpose"]
    }
  ],
  "flow": [
    {
      "step": int,
      "description": "High-detail technical step (e.g., 'API Route validates JWT via AuthMiddleware before hitting Service layer')"
    }
  ]
}"""


# ─────────────────── Groq client ───────────────────

_openai_client: AsyncOpenAI | None = None


def _get_llm_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        s = get_settings()
        # Use Nvidia NIM endpoint if configured, else fall back to standard OpenAI
        if s.nvidia_api_key:
            _openai_client = AsyncOpenAI(
                base_url="https://integrate.api.nvidia.com/v1",
                api_key=s.nvidia_api_key
            )
        else:
            _openai_client = AsyncOpenAI(api_key=s.groq_api_key, base_url="https://api.groq.com/openai/v1")
    return _openai_client


# ─────────────────── Service ───────────────────

class CodeAnalysisService:
    def __init__(self) -> None:
        self._client: AsyncOpenAI = _get_llm_client()
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

    @staticmethod
    def clone_github_repo(repo_url: str) -> str:
        """Clone a public GitHub repository into a temporary directory."""
        import subprocess

        if not repo_url.startswith("https://github.com/"):
            raise ValueError("Only standard https://github.com/ URLs are supported.")

        tmp_dir = tempfile.mkdtemp(prefix="github_clone_")
        target_dir = os.path.join(tmp_dir, "repo")

        try:
            logger.info("Cloning github repo %s into %s", repo_url, target_dir)
            subprocess.run(
                ["git", "clone", "--depth", "1", repo_url, target_dir],
                check=True,
                capture_output=True,
                text=True
            )
            return target_dir
        except subprocess.CalledProcessError as exc:
            logger.error("Git clone failed: %s", exc.stderr)
            raise ValueError(f"Failed to clone repository: {exc.stderr}") from exc


    # ── File tree builder ──

    @staticmethod
    def build_code_graph(root_dir: str) -> str:
        """Walk the directory, parse AST with NetworkX, and return JSON graph data."""
        from modules.team5_multimodal.graph_builder import CodeGraphBuilder
        import json
        import networkx as nx
        
        builder = CodeGraphBuilder(root_dir)
        builder.build_graph()
        graph = builder.graph
        
        in_degree = dict(graph.in_degree())
        out_degree = dict(graph.out_degree())
        try:
            betweenness = nx.betweenness_centrality(graph, k=min(50, len(graph.nodes)))
        except Exception:
            betweenness = {n: 0 for n in graph.nodes}

        top_files = []
        for node, data in graph.nodes(data=True):
            if data.get("type") == "file":
                score = (0.5 * in_degree.get(node, 0)) + (0.3 * out_degree.get(node, 0)) + (0.2 * betweenness.get(node, 0.0) * 100)
                top_files.append((node, score))
                
        top_files.sort(key=lambda x: x[1], reverse=True)
        top_central_files = [f[0] for f in top_files[:20]]
        
        graph_data = builder.serialize_graph(max_nodes=100)
        
        enriched_data = {
            "top_central_files": top_central_files,
            "graph_stats": {
                "total_nodes": len(graph.nodes),
                "total_edges": len(graph.edges),
            },
            "nodes": graph_data.get("nodes", []),
            "edges": graph_data.get("links", [])
        }
        
        return json.dumps(enriched_data)

    # ── Important file selector ──

    @staticmethod
    def select_important_files(root_dir: str) -> str:
        """Read key source files and return them as a formatted string."""
        root = Path(root_dir)
        selected: list[tuple[str, str]] = []  # (relative_path, content)

        # 1. Build graph for network metrics
        from modules.team5_multimodal.graph_builder import CodeGraphBuilder
        import networkx as nx
        
        builder = CodeGraphBuilder(root_dir)
        graph = builder.build_graph()
        
        in_degree = dict(graph.in_degree())
        out_degree = dict(graph.out_degree())
        try:
            betweenness = nx.betweenness_centrality(graph, k=min(100, len(graph.nodes)))
        except Exception:
            betweenness = {n: 0 for n in graph.nodes}

        def get_importance_score(rel_path: str) -> float:
            path_str = rel_path.replace("\\", "/")
            if path_str not in graph.nodes:
                return 0.0
            
            i_deg = in_degree.get(path_str, 0)
            o_deg = out_degree.get(path_str, 0)
            b_cent = betweenness.get(path_str, 0.0)
            return (0.5 * i_deg) + (0.3 * o_deg) + (0.2 * b_cent * 100)

        def is_probably_docs(content: str) -> bool:
            lines = content.splitlines()
            if len(lines) == 0:
                return True
            
            comment_lines = sum(1 for l in lines if l.strip().startswith(("#", "//", "/*", "* ")))
            comment_ratio = comment_lines / len(lines)
            
            tutorial_keywords = ["example", "tutorial", "guide", "how to", "step"]
            keyword_hits = sum(1 for l in lines if any(k in l.lower() for k in tutorial_keywords))
            
            return comment_ratio > 0.4 or keyword_hits > 10

        def is_entry_point(content: str) -> bool:
            entry_patterns = [
                'if __name__ == "__main__":',
                "FastAPI(",
                "@app.get",
                "APIRouter",
                "app.listen(",
                "server.listen("
            ]
            return any(pat in content for pat in entry_patterns)

        all_files = list(root.rglob("*"))
        file_candidates = []

        for path in all_files:
            if not path.is_file():
                continue
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            try:
                if path.stat().st_size > (MAX_FILE_SIZE_BYTES * 4): # Increased threshold
                    continue
            except OSError:
                continue

            # Include if source extension or config file
            if path.suffix.lower() in SOURCE_EXTENSIONS or path.name.lower() in CONFIG_FILES:
                try:
                    rel = str(path.relative_to(root))
                    content = path.read_text(encoding="utf-8", errors="replace")
                    if not content.strip():
                        continue
                        
                    if is_probably_docs(content):
                        continue
                        
                    is_entry = is_entry_point(content)
                    score = get_importance_score(rel)
                    
                    file_candidates.append({
                        "path": rel,
                        "content": content,
                        "score": score,
                        "is_entry": is_entry,
                        "is_config": path.name.lower() in CONFIG_FILES
                    })
                except Exception:
                    continue

        # Sort: Entry points first, then graph-based score weighting. Config files get slight bump.
        file_candidates.sort(key=lambda x: (x["is_entry"], x["score"] + (1.0 if x["is_config"] else 0.0)), reverse=True)

        for cand in file_candidates[:MAX_IMPORTANT_FILES]:
            content_lines = cand["content"].splitlines()
            if len(content_lines) > MAX_FILE_LINES:
                content = "\n".join(content_lines[:MAX_FILE_LINES]) + "\n... (truncated)"
            else:
                content = cand["content"]
            selected.append((cand["path"], content))

        # Format as snippets
        parts: list[str] = []
        for rel_path, content in selected:
            parts.append(f"### {rel_path}\n```\n{content}\n```\n")
        return "\n".join(parts)

    # ── LLM calls ──

    async def analyze_architecture(self, graph_json: str) -> CodeArchResult:
        """Pass 1: graph data JSON → architecture JSON."""
        user_msg = f"AST DEPENDENCY GRAPH (JSON node-link format):\n{graph_json}"
        model_id = self._settings.nvidia_model if self._settings.nvidia_api_key else self._settings.groq_model
        response = await self._client.chat.completions.create(
            model=model_id,
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
        model_id = self._settings.nvidia_model if self._settings.nvidia_api_key else self._settings.groq_model
        response = await self._client.chat.completions.create(
            model=model_id,
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
