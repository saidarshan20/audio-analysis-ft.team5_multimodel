"""
graph_builder.py - Deterministic AST Parsing for Codebase Dependencies

Uses tree-sitter to parse source files (Python, TypeScript) into a NetworkX DiGraph,
where Nodes are Files/Functions and Edges are Imports/Calls. This eliminates LLM 
hallucinations when building the application topology.
"""

import logging
import os
from pathlib import Path
from typing import Dict, List

import networkx as nx
import tree_sitter
from tree_sitter import Language, Parser
import tree_sitter_python as tspython
import tree_sitter_typescript as tstypescript

logger = logging.getLogger(__name__)

# ── Initialize Language Grammars ──
try:
    PY_LANGUAGE = Language(tspython.language())
    TS_LANGUAGE = Language(tstypescript.language_typescript())
    TSX_LANGUAGE = Language(tstypescript.language_tsx())
except Exception as e:
    logger.error("Failed to load tree-sitter grammars: %s", e)
    PY_LANGUAGE = None
    TS_LANGUAGE = None
    TSX_LANGUAGE = None

class CodeGraphBuilder:
    def __init__(self, repo_path: str):
        self.repo_path = Path(repo_path)
        self.graph = nx.DiGraph()
        
        # Determine parsers
        self.parsers = {}
        if PY_LANGUAGE:
            p_py = Parser(PY_LANGUAGE)
            self.parsers['.py'] = p_py
            
        if TS_LANGUAGE and TSX_LANGUAGE:
            p_ts = Parser(TS_LANGUAGE)
            p_tsx = Parser(TSX_LANGUAGE)
            self.parsers['.ts'] = p_ts
            self.parsers['.tsx'] = p_tsx
            self.parsers['.js'] = p_ts
            self.parsers['.jsx'] = p_tsx

    def _get_query_for_lang(self, ext: str):
        """Returns the appropriate tree-sitter query for the given file extension."""
        if ext == '.py':
            return PY_LANGUAGE.query("""
                (import_statement (dotted_name) @import)
                (import_from_statement module_name: (dotted_name) @from)
                (function_definition name: (identifier) @func_name)
                (class_definition name: (identifier) @class_name)
            """)
        elif ext in ['.ts', '.tsx', '.js', '.jsx']:
            # For TS/JS, we look for import declarations and function/class declarations
            lang = TS_LANGUAGE if ext in ['.ts', '.js'] else TSX_LANGUAGE
            return lang.query("""
                (import_statement source: (string (string_fragment) @import))
                (call_expression function: (identifier) @require_call arguments: (arguments (string (string_fragment) @import)) (#eq? @require_call "require"))
                (function_declaration name: (identifier) @func_name)
                (arrow_function) @func_name_arrow
                (class_declaration name: (identifier) @class_name)
            """)
        return None

    def _parse_file(self, full_path: Path) -> Dict[str, List[str]]:
        """Parses a single file and extracts imports and exported items."""
        ext = full_path.suffix.lower()
        parser = self.parsers.get(ext)
        if not parser:
            return {"imports": [], "functions": [], "classes": []}
            
        try:
            with open(full_path, "rb") as f:
                code_bytes = f.read()
                
            tree = parser.parse(code_bytes)
            query = self._get_query_for_lang(ext)
            
            if not query:
                return {"imports": [], "functions": [], "classes": []}
                
            cursor = tree_sitter.QueryCursor(query)
            captures = cursor.captures(tree.root_node)
            
            features = {"imports": [], "functions": [], "classes": []}
            
            for capture_name, nodes in captures.items():
                for node in nodes:
                    text = code_bytes[node.start_byte:node.end_byte].decode('utf-8', errors='replace')
                    
                    if capture_name in ("import", "from"):
                        features["imports"].append(text)
                    elif capture_name == "func_name":
                        features["functions"].append(text)
                    elif capture_name == "class_name":
                        features["classes"].append(text)
                        
            return features
            
        except Exception as e:
            logger.warning("Error parsing %s: %s", full_path, e)
            return {"imports": [], "functions": [], "classes": []}

    def build_graph(self) -> nx.DiGraph:
        """Walks the directory and builds the deterministic NetworkX graph."""
        skip_dirs = {
            "__pycache__", ".git", ".svn", "node_modules", ".venv", "venv",
            "dist", "build", ".next", ".idea", ".vscode", "docs", "tests",
            "scripts", "examples", "benchmarks", "site", "test"
        }
        
        for root, dirs, files in os.walk(self.repo_path):
            # Filter out ignored directories aggressively
            dirs[:] = [
                d for d in dirs 
                if not d.startswith('.') 
                and d not in skip_dirs
                and not d.startswith('test')
                and not d.startswith('doc')
                and not d.startswith('example')
                and not d.startswith('script')
            ]
            
            for file in files:
                ext = Path(file).suffix.lower()
                
                # Only add files we care about to the graph structure
                if ext in self.parsers or ext in ['.json', '.yml', '.yaml', '.md', '.txt', '.toml']:
                    full_path = Path(root) / file
                    try:
                        rel_path = full_path.relative_to(self.repo_path).as_posix()
                    except ValueError:
                        continue
                        
                    # 1. Add file Node
                    self.graph.add_node(rel_path, type="file", ext=ext)
                    
                    # 2. Extract AST specifics if parser exists
                    if ext in self.parsers:
                        features = self._parse_file(full_path)
                        
                        for f in features["functions"]:
                            f_id = f"{rel_path}::{f}"
                            self.graph.add_node(f_id, type="function", name=f)
                            self.graph.add_edge(rel_path, f_id, relation="CONTAINS")
                            
                        for c in features["classes"]:
                            c_id = f"{rel_path}::{c}"
                            self.graph.add_node(c_id, type="class", name=c)
                            self.graph.add_edge(rel_path, c_id, relation="CONTAINS")
                            
                        for imp in features["imports"]:
                            # Naive resolution: we just map the raw string. In V3 we could resolve local logic
                            # vs third-party packages to make this a true dependency graph.
                            self.graph.add_edge(rel_path, imp, relation="IMPORTS")
                            
        return self.graph

    def serialize_graph(self, max_nodes: int = 300) -> dict:
        """Converts the NetworkX graph to a JSON-serializable dictionary.
        Truncates the graph to top highly-connected nodes if it's too large for LLM context windows.
        """
        if len(self.graph.nodes) > max_nodes:
            logger.info("Graph too large (%d nodes). Truncating to top %d.", len(self.graph.nodes), max_nodes)
            nodes_sorted_by_degree = sorted(self.graph.degree, key=lambda x: x[1], reverse=True)
            top_nodes = [n for n, d in nodes_sorted_by_degree[:max_nodes]]
            subgraph = self.graph.subgraph(top_nodes)
            return nx.node_link_data(subgraph)
            
        return nx.node_link_data(self.graph)
