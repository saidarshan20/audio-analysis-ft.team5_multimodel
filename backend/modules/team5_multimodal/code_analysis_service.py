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
import time
import zipfile
from pathlib import Path
from typing import Annotated, Any, Dict

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END
from pydantic import BaseModel, Field, ValidationError

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

MAX_FILE_LINES = 350        # cap per file for Pass 2
MAX_IMPORTANT_FILES = 20     # how many files to send in Pass 2
MAX_FILE_SIZE_BYTES = 30_000  # allow slightly larger files


# ─────────────────── Prompts ───────────────────

EXPLANATION_SYSTEM_PROMPT = """You are a principal software engineer analyzing a codebase from its file dependency graph.

You will receive file paths organized with their local imports, exported functions, and classes.

Write a concise architectural explanation covering:
1. What is the purpose of this system?
2. What are the 3-6 main subsystems and their responsibilities? Reference actual directory names and file names.
3. What are the key data flows (e.g. HTTP request → route handler → service → DB → response)?
4. What tech stack is visible from file names, imports, and config files?
5. Any notable architectural patterns (REST API, layered architecture, event-driven, etc.)?

Rules:
- 8-14 short, concrete paragraphs
- Reference actual file names and directories — be specific to this repo
- Do NOT output Mermaid, JSON, or code blocks
- Do NOT list every single file — identify logical groupings only
"""

ARCH_SYSTEM_PROMPT = """You are a repository-to-graph planner. You will receive a plain-English explanation of the codebase and a list of actual file paths.

Produce an opinionated, high-signal architecture graph — not an inventory dump.

STRICT CONSTRAINTS:
- groups: 2-8 (logical subsystems, e.g. "Frontend", "API Routes", "Core Services", "Data Layer")
- nodes: 14-24 (architecturally significant components only — skip tests, lock files, trivial utils)
- edges: 10-30 (meaningful flows: data, control, imports, API calls)
- Node labels: 1-4 words, specific (e.g. "JWT Auth Service", "SQLite Store", "UMAP Clusterer")
- Edge labels: 1-4 words (e.g. "REST call", "imports", "SQL query", "streams to")

SHAPES (use sparingly, only where semantically meaningful):
- "database" — persistent storage, DB access layer
- "queue" — async queues, event buses, background workers
- "hexagon" — external third-party APIs (OpenAI, Stripe, GitHub API, etc.)
- "circle" — central orchestrators or entry points
- "box" — default for everything else

PATH RULE: Only set "path" if a single specific file maps cleanly to this node AND that path appears in the file list provided. Leave path empty otherwise.
STYLE RULE: "dashed" edges for optional/async/event flows; "solid" for direct imports and API calls.

Return ONLY valid JSON. No markdown, no comments, no explanation outside the JSON.

SCHEMA:
{
  "title": "string — specific project name or purpose",
  "summary": "3-4 sentence technical description covering purpose, tech, and architectural style",
  "tech_stack": ["FastAPI", "React", "LangChain"],
  "detected_patterns": ["Router Pattern", "JWT Auth", "Repository Pattern"],
  "groups": [
    {"id": "kebab-case-id", "label": "Human Readable Group Name"}
  ],
  "nodes": [
    {
      "id": "kebab-case-unique-id",
      "label": "Short Node Name",
      "type": "concise type (e.g. FastAPI router, SQLite store, React page)",
      "description": "1 sentence role",
      "group_id": "group-id-or-empty-string",
      "path": "relative/file/path.py",
      "shape": "box"
    }
  ],
  "edges": [
    {
      "source": "node-id",
      "target": "node-id",
      "label": "short label",
      "style": "solid"
    }
  ]
}"""

DETAIL_SYSTEM_PROMPT = """You are a lead engineer doing a deep technical review of a codebase for a new architect.

You receive: (1) an architecture map with components and connections, (2) annotated source files showing which component each file belongs to.

YOUR TASK:
- Trace the **primary request lifecycle** end-to-end (e.g., HTTP request → route → service → DB → response).
- For each key file, explain its **concrete role** — what it owns, what it delegates, and why.
- List **key_functions** with their actual function names and what they do technically.
- Flag **tech_debt**: hardcoded values, missing abstractions, duplicated logic, synchronous blocking in async code.
- Flag **security_risks**: missing auth checks, unvalidated inputs, weak hashing, token storage issues, SQL injection vectors.
- Add **recommendations**: concrete, prioritized improvements (e.g., "Replace SHA-256 with bcrypt for password hashing").
- Be specific — reference actual function names, file paths, and line-level details where visible.
- Return ONLY valid JSON — no markdown, no prose.

SCHEMA:
{
  "key_files": [
    {
      "file_path": "relative/path.py",
      "component": "component name from architecture",
      "summary": "2-3 sentence concrete explanation of this file's role",
      "key_functions": ["function_name: what it does and why it matters"]
    }
  ],
  "flow": [
    {
      "step": 1,
      "description": "Specific technical step referencing actual functions/files (e.g., 'POST /auth/login → login() in auth_router.py → verify_password() in auth_utils.py → create_access_token() returns JWT')"
    }
  ],
  "tech_debt": ["Specific item with file reference (e.g., 'auth_utils.py uses SHA-256 without salt — vulnerable to rainbow tables')"],
  "security_risks": ["Specific risk with file reference and impact"],
  "recommendations": ["Prioritized, actionable improvement with rationale"]
}"""


# ─────────────────── State Definition ───────────────────

def merge_metadata(left: Dict[str, Any], right: Dict[str, Any]) -> Dict[str, Any]:
    """Merge two metadata dictionaries, aggregating token counts if they exist."""
    new_meta = {**left, **right}
    # Aggregate tokens if both have them
    for key in ["input_tokens", "output_tokens", "total_tokens"]:
        if key in left and key in right:
            new_meta[key] = left[key] + right[key]
    return new_meta


class AnalysisState(BaseModel):
    root_dir: str
    repo_name: str | None = None
    file_count: int = 0
    graph_data: Dict[str, Any] | None = None
    explanation: str | None = None
    architecture: CodeArchResult | None = None
    details: CodeDetailResult | None = None
    status_message: str = "Initializing LangGraph workflow..."
    metadata: Annotated[Dict[str, Any], merge_metadata] = Field(default_factory=dict)
    error: str | None = None

# ─────────────────── LLM client (Azure / NVIDIA / Groq) ───────────────────
# Centralised in config.py so personal-laptop (Groq/NVIDIA) and office-laptop
# (Azure OpenAI) both work without touching this file.
from modules.team5_multimodal.config import get_llm_client as _get_llm_client

def _get_langchain_model(force_groq: bool = False) -> ChatOpenAI:
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
            temperature=0,
            timeout=90,
            max_retries=2
        )
    elif s.nvidia_api_key:
        return ChatOpenAI(
            model=s.nvidia_model,
            openai_api_key=s.nvidia_api_key,
            openai_api_base="https://integrate.api.nvidia.com/v1",
            temperature=0,
            timeout=90,
            max_retries=2
        )
    else:
        # Fallback to Groq if key exists
        return ChatOpenAI(
            model=s.groq_model,
            openai_api_key=s.groq_api_key,
            openai_api_base="https://api.groq.com/openai/v1",
            temperature=0,
            timeout=90
        )


# ─────────────────── Service ───────────────────

class CodeAnalysisService:
    def __init__(self) -> None:
        self._client, self._model_name = _get_llm_client()
        self._settings = get_settings()
        self._workflow = self._build_workflow()

    def _build_workflow(self):
        workflow = StateGraph(AnalysisState)

        workflow.add_node("graphing", self.graphing_node)
        workflow.add_node("explaining", self.explanation_node)
        workflow.add_node("architecting", self.arch_node)
        workflow.add_node("detailing", self.detail_node)

        workflow.set_entry_point("graphing")
        workflow.add_edge("graphing", "explaining")
        workflow.add_edge("explaining", "architecting")
        workflow.add_edge("architecting", "detailing")
        workflow.add_edge("detailing", END)

        return workflow.compile()

    # ─────────────────── LangGraph Nodes ───────────────────

    @staticmethod
    def graphing_node(state: AnalysisState) -> Dict[str, Any]:
        """Node 1: Extract AST Graph Data."""
        state = AnalysisState.model_validate(state)
        root_dir = state.root_dir
        logger.info("[LangGraph] Node: graphing started for %s", root_dir)
        
        graph_json = CodeAnalysisService.build_code_graph(root_dir)
        graph_data = json.loads(graph_json)
        
        # Count total files
        file_count = 0
        for _, _, files in os.walk(root_dir):
            file_count += len(files)
            
        source_files_count = len(graph_data.get("file_nodes", []))
        dependency_edges_count = len(graph_data.get("key_dependencies", []))

        return {
            "graph_data": graph_data,
            "file_count": file_count,
            "metadata": {
                "nodes_count": source_files_count,
                "edges_count": dependency_edges_count,
            },
            "status_message": "Codebase graphed via tree-sitter."
        }

    async def explanation_node(self, state: AnalysisState) -> Dict[str, Any]:
        """Node 1.5: Generate plain-English explanation from file graph (gitdiagram pass 1)."""
        state = AnalysisState.model_validate(state)
        logger.info("[LangGraph] Node: explaining started")
        graph_data = state.graph_data or {}
        file_nodes = graph_data.get("file_nodes", [])
        entry_points = set(graph_data.get("entry_points", []))

        # Cap to top 60 files and 30K chars to avoid NVIDIA context limits
        MAX_FILES = 60
        MAX_CHARS = 30_000
        file_nodes_capped = file_nodes[:MAX_FILES]

        lines = []
        total_chars = 0
        for fn in file_nodes_capped:
            path = fn["path"]
            tag = " [ENTRY POINT]" if path in entry_points else ""
            line = f"  {path}{tag}"
            items = []
            if fn.get("classes"):
                items.append(f"classes: {', '.join(fn['classes'][:5])}")
            if fn.get("functions"):
                items.append(f"fns: {', '.join(fn['functions'][:8])}")
            if fn.get("imports"):
                items.append(f"imports: {', '.join(fn['imports'][:5])}")
            if items:
                line += f"\n    → {' | '.join(items)}"
            total_chars += len(line)
            if total_chars > MAX_CHARS:
                lines.append(f"  ... (truncated for context limit)")
                break
            lines.append(line)

        user_msg = f"FILE DEPENDENCY GRAPH ({len(file_nodes)} total files, showing top {len(file_nodes_capped)}):\n" + "\n".join(lines)
        model = _get_langchain_model()
        messages = [
            SystemMessage(content=EXPLANATION_SYSTEM_PROMPT),
            HumanMessage(content=user_msg),
        ]
        response = await model.ainvoke(messages)
        explanation = str(response.content).strip()
        logger.info("[LangGraph] Node: explaining done (%d chars)", len(explanation))
        return {
            "explanation": explanation,
            "status_message": "Codebase architecture understood.",
        }

    async def arch_node(self, state: AnalysisState) -> Dict[str, Any]:
        """Node 2: Graph planning pass — produces groups/nodes/edges JSON (gitdiagram pass 2)."""
        state = AnalysisState.model_validate(state)
        logger.info("[LangGraph] Node: architecting started")
        explanation = state.explanation or ""
        graph_data = state.graph_data or {}

        # Flat file list for path grounding
        file_nodes = graph_data.get("file_nodes", [])
        file_list = "\n".join(fn["path"] for fn in file_nodes[:60])

        user_msg = f"EXPLANATION:\n{explanation}\n\nFILE LIST (use these paths only):\n{file_list}"
        model = _get_langchain_model()
        structured_model = model.with_structured_output(CodeArchResult, include_raw=True)
        
        messages = [
            SystemMessage(content=ARCH_SYSTEM_PROMPT),
            HumanMessage(content=user_msg)
        ]
        
        logger.info("[LangGraph] Node: architecting invoking LLM...")
        try:
            response = await structured_model.ainvoke(messages)
            logger.info("[LangGraph] Node: architecting LLM responded")
            raw_response = response.get("raw")
            usage = getattr(raw_response, "usage_metadata", None) or {}
            if response.get("parsing_error"):
                raise ValueError(f"Architecture response failed schema parsing: {response['parsing_error']}")
            arch_data = CodeArchResult.model_validate(response.get("parsed"))
        except (ValidationError, ValueError) as e:
            logger.error("[LangGraph] Node: architecting validation failed: %s", str(e))
            raise
        except Exception as e:
            logger.error("[LangGraph] Node: architecting LLM failed: %s", str(e))
            raise

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
        state = AnalysisState.model_validate(state)
        logger.info("[LangGraph] Node: detailing started")
        root_dir = state.root_dir
        arch_data = state.architecture
        if arch_data is None:
            raise ValueError("Architecture analysis is missing; cannot run detail analysis.")

        # Build a file→node label lookup so the LLM knows which component each file belongs to
        file_to_component: dict[str, str] = {}
        for node in arch_data.nodes:
            if node.path:
                file_to_component[node.path] = node.label

        code_snippets = self.select_important_files(root_dir, file_to_component)

        # Give the LLM focused architecture context (not full JSON dump)
        arch_summary = {
            "title": arch_data.title,
            "tech_stack": arch_data.tech_stack,
            "groups": [group.model_dump() for group in arch_data.groups],
            "nodes": [
                {"label": n.label, "type": n.type, "path": n.path, "group_id": n.group_id}
                for n in arch_data.nodes
            ],
            "edges": [
                {"source": e.source, "target": e.target, "label": e.label}
                for e in arch_data.edges
            ],
        }
        context = json.dumps(arch_summary, indent=2)
        user_msg = f"ARCHITECTURE:\n{context}\n\nSOURCE FILES (annotated with component):\n{code_snippets}"
        
        model = _get_langchain_model()
        structured_model = model.with_structured_output(CodeDetailResult, include_raw=True)
        messages = [
            SystemMessage(content=DETAIL_SYSTEM_PROMPT),
            HumanMessage(content=user_msg)
        ]
        
        try:
            response = await structured_model.ainvoke(messages)
            usage = getattr(response.get("raw"), "usage_metadata", None) or {}
            if response.get("parsing_error"):
                raise ValueError(f"Detail response failed schema parsing: {response['parsing_error']}")
            detail_data = CodeDetailResult.model_validate(response.get("parsed"))
        except (ValidationError, ValueError) as e:
            logger.error("[LangGraph] Node: detailing validation failed: %s", str(e))
            raise
        except Exception as e:
            logger.error("[LangGraph] Node: detailing LLM failed: %s", str(e))
            raise

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
            initial_state = AnalysisState(root_dir=root_dir, repo_name=repo_name)

            final_file_count = 0
            final_arch = None
            final_details = None
            final_metadata = {}

            step_map = {
                "graphing": "graphing",
                "explaining": "explaining",
                "architecting": "arch",
                "detailing": "details",
            }

            async for event in self._workflow.astream_events(initial_state, version="v2"):
                kind = event["event"]
                name = event["name"]

                if kind == "on_chain_start" and name in step_map:
                    messages = {
                        "graphing":    "Building codebase AST dependency graph...",
                        "explaining":  "Understanding architecture (Pass 1)...",
                        "architecting":"Planning architecture graph (Pass 2)...",
                        "detailing":   "Deep file analysis (Pass 3)...",
                    }
                    yield {
                        "type": "progress",
                        "step": step_map[name],
                        "message": messages.get(name, f"Starting {name}..."),
                    }
                
                # 2. Node Update: Capture state changes (final results for each node)
                elif kind == "on_chain_end" and name in step_map:
                    # In astream_events, the end event's 'output' contains the node return data
                    output = event["data"].get("output", {})
                    if isinstance(output, BaseModel):
                        output = output.model_dump()
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
                "architecture": final_arch.model_dump() if isinstance(final_arch, CodeArchResult) else final_arch,
                "details": final_details.model_dump() if isinstance(final_details, CodeDetailResult) else final_details,
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
        
        # Identify entry points for context
        entry_points = []
        for node in graph.nodes:
            if graph.nodes[node].get("type") == "file":
                try:
                    content = Path(root_dir).joinpath(node).read_text(errors="ignore")
                    if any(pat in content for pat in [
                        "if __name__ == '__main__':", "FastAPI(", "app.listen",
                        "express()", "createApp(", "uvicorn.run("
                    ]):
                        entry_points.append(node)
                except Exception:
                    pass

        # Build a clean file-level summary (no function/class/import-string nodes)
        file_nodes = []
        for node, data in graph.nodes(data=True):
            if data.get("type") != "file":
                continue
            # Functions and classes defined in this file
            functions = [
                graph.nodes[s].get("name", s.split("::")[-1])
                for s in graph.successors(node)
                if graph.nodes[s].get("type") == "function"
            ]
            classes = [
                graph.nodes[s].get("name", s.split("::")[-1])
                for s in graph.successors(node)
                if graph.nodes[s].get("type") == "class"
            ]
            # Local file imports (only other file nodes, not raw import strings)
            local_imports = [
                t for t in graph.successors(node)
                if graph.nodes.get(t, {}).get("type") == "file"
            ]
            score = (
                0.5 * in_degree.get(node, 0)
                + 0.3 * out_degree.get(node, 0)
                + 0.2 * betweenness.get(node, 0.0) * 100
            )
            file_nodes.append({
                "path": node,
                "ext": data.get("ext", ""),
                "importance_score": round(score, 2),
                "is_entry": node in entry_points,
                "imports": local_imports[:10],
                "functions": functions[:15],
                "classes": classes[:10],
            })

        file_nodes.sort(key=lambda x: (x["is_entry"], x["importance_score"]), reverse=True)
        top_file_nodes = file_nodes[:50]
        top_paths = {f["path"] for f in top_file_nodes}

        # Only edges between file-level nodes in the top set
        key_dependencies = [
            {"source": src, "target": tgt}
            for src, tgt in graph.edges()
            if src in top_paths
            and tgt in top_paths
            and graph.nodes.get(src, {}).get("type") == "file"
            and graph.nodes.get(tgt, {}).get("type") == "file"
        ][:80]

        enriched_data = {
            "entry_points": entry_points,
            "top_central_files": top_central_files[:20],
            "graph_stats": {
                "total_file_nodes": len([n for n, d in graph.nodes(data=True) if d.get("type") == "file"]),
                "total_edges": len(graph.edges),
            },
            "file_nodes": top_file_nodes,
            "key_dependencies": key_dependencies,
        }

        return json.dumps(enriched_data)

    # ── Important file selector ──

    @staticmethod
    def select_important_files(root_dir: str, file_to_component: dict[str, str] | None = None) -> str:
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

        # Format as snippets, annotated with component if known
        file_to_component = file_to_component or {}
        parts: list[str] = []
        for rel_path, content in selected:
            component_label = file_to_component.get(rel_path, "")
            header = f"### {rel_path}"
            if component_label:
                header += f"  [Component: {component_label}]"
            parts.append(f"{header}\n```\n{content}\n```\n")
        return "\n".join(parts)

    # ── LLM calls ──
    # [DEPRECATED] These logic blocks are now handled by LangGraph nodes above.
