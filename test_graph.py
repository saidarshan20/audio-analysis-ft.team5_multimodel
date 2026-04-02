import json
from pathlib import Path
from modules.team5_multimodal.graph_builder import CodeGraphBuilder

import networkx as nx

def main():
    print("Initializing CodeGraphBuilder for test...")
    # Pick a simple module with imports and functions, e.g., image_analysis_service.py
    file_path = "modules/team5_multimodal/image_analysis_service.py"
    
    # We create a builder but hack the root to just analyze the file
    builder = CodeGraphBuilder("modules/team5_multimodal")
    
    # Force single parse
    full_path = Path(file_path)
    res = builder._parse_file(full_path)
    
    print("--- PARSE RESULTS ---")
    print(json.dumps(res, indent=2))
    
    # Let's see what a graph looks like for the whole directory
    print("\n--- GRAPH RESULTS ---")
    graph = builder.build_graph()
    stats = {
        "nodes": graph.number_of_nodes(),
        "edges": graph.number_of_edges()
    }
    print(json.dumps(stats, indent=2))
    
    
if __name__ == "__main__":
    main()
