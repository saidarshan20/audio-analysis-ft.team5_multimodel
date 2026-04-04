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
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END
from typing import TypedDict, Optional, List, Dict, Any, Annotated

from modules.team5_multimodal.config import get_settings
from modules.team5_multimodal.models import CodeArchResult, CodeDetailResult

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
# Ensure prints go to stdout for terminal visibility
import sys
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
if not logger.handlers:
    logger.addHandler(handler)

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
- **Avoid Vague Containers**: Do NOT name a component "Presentation Layer". Instead, identify the actual physical entities (e.g., "Web Storefront", "Auth Controller", "Prisma Database", "FastAPI Server").
- **Physical Mapping**: Map related files to their corresponding logical component. If multiple files (e.g., `user_routes.py`, `user_schema.py`) form a feature, group them into a single component like "User Management Service".
- **Detect entry points**: Use the provided `entry_points` and `top_central_files` to anchor the diagram.
- **Layers**: Assign these components to one of the following architectural layers (but name the component specifically):
  - **Presentation**: UI components, API routes, Controllers.
  - **Application**: Business services, Orchestrators, Use cases.
  - **Domain**: Core models, Entities, Pure logic.
  - **Infrastructure**: Database clients, External API wrappers, Middleware.
- **Design Patterns**: Note any patterns (e.g., Factory, Singleton, Observer, Middleware).
- Return ONLY valid JSON.

SCHEMA:
{
  "title": "string",
  "summary": "2-3 sentence high-level description",
  "detected_patterns": ["Pattern Name 1"],
  "components": [
    {
      "id": "string",
      "name": "Specific Name (e.g. Auth Service)",
      "type": "frontend | backend | api | database | service | config | other",
      "layer": "presentation | application | domain | infrastructure | other",
      "description": " technical role",
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
}"""

DETAIL_SYSTEM_PROMPT = """You are a lead engineer explaining a codebase to a new architect.

Your task is to analyze the provided code snippets and the architecture context to explain HOW components interact and WHY specific logic exists.

IMPORTANT RULES:
- Focus on **Critical Paths**: Explain the lifecycle of a request or the core data transformation.
- Highlight **Technical Debt**, hardcodes, or missing abstractions.
- Flag **Security Vulnerabilities** like N+1 queries, unvalidated inputs, or missing auth layers.
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
  ],
  "tech_debt": ["List item 1 of discovered tech debt"],
  "security_risks": ["List item 1 of discovered security risks"]
}"""


# ─────────────────── State Definition ───────────────────

import time
from typing import TypedDict, Optional, List, Dict, Any, Annotated
import operator

def merge_metadata(left: Dict[str, Any], right: Dict[str, Any]) -> Dict[str, Any]:
    """Merge two metadata dictionaries, aggregating token counts if they exist."""
    new_meta = {**left, **right}
    # Aggregate tokens if both have them
    for key in ["input_tokens", "output_tokens", "total_tokens"]:
        if key in left and key in right:
            new_meta[key] = left[key] + right[key]
    return new_meta

class AnalysisState(TypedDict):
    root_dir: str
    repo_name: Optional[str]
    file_count: int
    graph_data: Optional[Dict[str, Any]]
    architecture: Optional[Dict[str, Any]]
    details: Optional[Dict[str, Any]]
    status_message: str
    metadata: Annotated[Dict[str, Any], merge_metadata]
    error: Optional[str]

# ─────────────────── Groq client ───────────────────

_openai_client: AsyncOpenAI | None = None

def _get_llm_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        s = get_settings()
        if s.nvidia_api_key:
            _openai_client = AsyncOpenAI(
                base_url="https://integrate.api.nvidia.com/v1",
                api_key=s.nvidia_api_key
            )
        else:
            _openai_client = AsyncOpenAI(api_key=s.groq_api_key, base_url="https://api.groq.com/openai/v1")
    return _openai_client

def _get_langchain_model(force_groq: bool = True) -> ChatOpenAI:
    """Get the LangChain ChatOpenAI adapter. 
    Defaults to Groq for code analysis due to superior inference speed on large AST-to-JSON tasks.
    """
    s = get_settings()
    # Prioritize Groq unless it's missing or force_groq=False
    if force_groq and s.groq_api_key:
        return ChatOpenAI(
            model=s.groq_model,
            openai_api_key=s.groq_api_key,
            openai_api_base="https://api.groq.com/openai/v1",
            temperature=0.1,
            timeout=60,
            max_retries=2
        )
    elif s.nvidia_api_key:
        return ChatOpenAI(
            model=s.nvidia_model,
            openai_api_key=s.nvidia_api_key,
            openai_api_base="https://integrate.api.nvidia.com/v1",
            temperature=0.1,
            timeout=60,
            max_retries=2
        )
    else:
        # Fallback to Groq if key exists
        return ChatOpenAI(
            model=s.groq_model,
            openai_api_key=s.groq_api_key,
            openai_api_base="https://api.groq.com/openai/v1",
            temperature=0.1,
            timeout=60
        )


# ─────────────────── Service ───────────────────

class CodeAnalysisService:
    def __init__(self) -> None:
        self._client: AsyncOpenAI = _get_llm_client()
        self._settings = get_settings()
        self._workflow = self._build_workflow()

    def _build_workflow(self):
        workflow = StateGraph(AnalysisState)
        
        # Add Nodes
        workflow.add_node("graphing", self.graphing_node)
        workflow.add_node("architecting", self.arch_node)
        workflow.add_node("detailing", self.detail_node)
        
        # Define Edges (Linear Flow for MVP)
        workflow.set_entry_point("graphing")
        workflow.add_edge("graphing", "architecting")
        workflow.add_edge("architecting", "detailing")
        workflow.add_edge("detailing", END)
        
        return workflow.compile()

    # ─────────────────── LangGraph Nodes ───────────────────

    @staticmethod
    def graphing_node(state: AnalysisState) -> Dict[str, Any]:
        """Node 1: Extract AST Graph Data."""
        root_dir = state["root_dir"]
        logger.info("[LangGraph] Node: graphing started for %s", root_dir)
        
        graph_json = CodeAnalysisService.build_code_graph(root_dir)
        graph_data = json.loads(graph_json)
        
        # Count total files
        file_count = 0
        for _, _, files in os.walk(root_dir):
            file_count += len(files)
            
        nodes_count = len(graph_data.get("nodes", []))
        edges_count = len(graph_data.get("links", []))
            
        return {
            "graph_data": graph_data,
            "file_count": file_count,
            "metadata": {
                "nodes_count": nodes_count,
                "edges_count": edges_count,
            },
            "status_message": "Codebase graphed via tree-sitter."
        }

    async def arch_node(self, state: AnalysisState) -> Dict[str, Any]:
        """Node 2: System-level Architecture Pass."""
        logger.info("[LangGraph] Node: architecting started")
        graph_data = state["graph_data"]
        graph_json = json.dumps(graph_data)
        
        user_msg = f"AST DEPENDENCY GRAPH (JSON node-link format):\n{graph_json}"
        model = _get_langchain_model()
        
        messages = [
            SystemMessage(content=ARCH_SYSTEM_PROMPT),
            HumanMessage(content=user_msg)
        ]
        
        logger.info("[LangGraph] Node: architecting invoking LLM...")
        try:
            response = await model.ainvoke(messages)
            logger.info("[LangGraph] Node: architecting LLM responded")
            usage = getattr(response, "usage_metadata", {})
        except Exception as e:
            logger.error("[LangGraph] Node: architecting LLM failed: %s", str(e))
            raise
            
        # Ensure we parse the string content correctly
        content_str = str(response.content)
        # Handle potential markdown wrapping
        if "```json" in content_str:
            content_str = content_str.split("```json")[1].split("```")[0].strip()
        elif "```" in content_str:
             content_str = content_str.split("```")[1].split("```")[0].strip()
             
        arch_data = json.loads(content_str)
        return {
            "architecture": arch_data,
            "metadata": {
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
                "arch_model": getattr(model, "model_name", "llama-3.3-70b-versatile"),
                "arch_context_chars": len(user_msg)
            },
            "status_message": "Architecture map generated."
        }

    async def detail_node(self, state: AnalysisState) -> Dict[str, Any]:
        """Node 3: Deep File-level Analysis Pass."""
        logger.info("[LangGraph] Node: detailing started")
        root_dir = state["root_dir"]
        arch_data = state["architecture"]
        
        code_snippets = self.select_important_files(root_dir)
        context = json.dumps(arch_data, indent=2)
        user_msg = f"CONTEXT:\n{context}\n\nFILES:\n{code_snippets}"
        
        model = _get_langchain_model()
        messages = [
            SystemMessage(content=DETAIL_SYSTEM_PROMPT),
            HumanMessage(content=user_msg)
        ]
        
        response = await model.ainvoke(messages)
        usage = getattr(response, "usage_metadata", {})
        content_str = str(response.content)
        if "```json" in content_str:
            content_str = content_str.split("```json")[1].split("```")[0].strip()
        elif "```" in content_str:
             content_str = content_str.split("```")[1].split("```")[0].strip()
             
        detail_data = json.loads(content_str)
        return {
            "details": detail_data,
            "metadata": {
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
                "detail_model": getattr(model, "model_name", "llama-3.3-70b-versatile"),
                "detail_context_chars": len(user_msg)
            },
            "status_message": "Detailed analysis complete."
        }

    async def analyze_repo_stream(self, root_dir: str, repo_name: str | None = None):
        """Async generator that yields JSON status updates and finally the result."""
        start_time = time.time()
        try:
            initial_state: AnalysisState = {
                "root_dir": root_dir,
                "repo_name": repo_name,
                "file_count": 0,
                "graph_data": None,
                "architecture": None,
                "details": None,
                "status_message": "Initializing LangGraph workflow...",
                "metadata": {},
                "error": None
            }
            
            # Step trackers for local accumulation
            final_file_count = 0
            final_arch = None
            final_details = None
            final_metadata = {}
            
            # Use astream_events (v2) for granular progress (started/finished)
            step_map = {
                "graphing": "graphing",
                "architecting": "arch",
                "detailing": "details"
            }
            
            async for event in self._workflow.astream_events(initial_state, version="v2"):
                kind = event["event"]
                name = event["name"]
                
                # 1. Node Start: Notify user we are beginning work
                if kind == "on_chain_start" and name in step_map:
                    display_step = step_map[name]
                    messages = {
                        "graphing": "Building codebase AST dependency graph...",
                        "architecting": "Architecting system components (LLM reasoning)...",
                        "detailing": "Performing deep file logic analysis (Pass 2)..."
                    }
                    yield {
                        "type": "progress",
                        "step": display_step,
                        "message": messages.get(name, f"Starting {name}...")
                    }
                
                # 2. Node Update: Capture state changes (final results for each node)
                elif kind == "on_chain_end" and name in step_map:
                    # In astream_events, the end event's 'output' contains the node return data
                    output = event["data"].get("output", {})
                    if "file_count" in output: final_file_count = output["file_count"]
                    if "architecture" in output: final_arch = output["architecture"]
                    if "details" in output: final_details = output["details"]
                    if "metadata" in output:
                        final_metadata = merge_metadata(final_metadata, output["metadata"])
                    
                    yield {
                        "type": "progress",
                        "step": step_map[name],
                        "message": output.get("status_message", f"Step {name} complete.")
                    }
            
            duration = time.time() - start_time
            final_metadata["total_duration_sec"] = round(duration, 2)
            
            yield {"type": "progress", "step": "done", "message": "Analysis complete!"}
            
            result = {
                "filename": repo_name or "uploaded_code.zip",
                "file_count": final_file_count,
                "architecture": final_arch,
                "details": final_details,
                "metadata": final_metadata
            }
            yield {"type": "result", "payload": result}

        except Exception as e:
            logger.exception("Stream analysis failed")
            yield {"type": "error", "message": str(e)}

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
        
        # Identify entry points for context
        entry_points = []
        for node in graph.nodes:
             if graph.nodes[node].get("type") == "file":
                 try:
                     content = Path(root_dir).joinpath(node).read_text(errors="ignore")
                     # simple check
                     if any(pat in content for pat in ["if __name__ == '__main__':", "FastAPI(", "app.listen", "express()"]):
                         entry_points.append(node)
                 except: pass

        enriched_data = {
            "entry_points": entry_points,
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
        import subprocess
        
        builder = CodeGraphBuilder(root_dir)
        graph = builder.build_graph()
        
        in_degree = dict(graph.in_degree())
        out_degree = dict(graph.out_degree())
        try:
            betweenness = nx.betweenness_centrality(graph, k=min(100, len(graph.nodes)))
        except Exception:
            betweenness = {n: 0 for n in graph.nodes}

        # Compute Git Churn
        git_churn: dict[str, int] = {}
        try:
            if (root / ".git").exists():
                churn_out = subprocess.check_output(
                    ["git", "log", "--pretty=format:", "--name-only"], 
                    cwd=str(root), text=True, stderr=subprocess.DEVNULL
                )
                for line in churn_out.splitlines():
                    line = line.strip()
                    if line:
                        git_churn[line] = git_churn.get(line, 0) + 1
        except Exception as e:
            logger.warning("Git churn calculation failed: %s", e)
            
        max_churn = max([1, *git_churn.values()])

        def get_importance_score(rel_path: str) -> float:
            path_str = rel_path.replace("\\", "/")
            
            churn_count = git_churn.get(path_str, 0)
            churn_multiplier = 1.0 + (churn_count / max_churn) * 2.0  # Boost up to 3x based on activity
            
            if path_str not in graph.nodes:
                return 0.1 * churn_multiplier
            
            i_deg = in_degree.get(path_str, 0)
            o_deg = out_degree.get(path_str, 0)
            b_cent = betweenness.get(path_str, 0.0)
            score = (0.5 * i_deg) + (0.3 * o_deg) + (0.2 * b_cent * 100)
            return score * churn_multiplier

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
    # [DEPRECATED] These logic blocks are now handled by LangGraph nodes above.
