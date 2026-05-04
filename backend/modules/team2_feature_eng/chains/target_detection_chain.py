import json
from langchain_core.prompts import ChatPromptTemplate
from ..llm.llm_provider import get_llm
from ..schemas import TargetDetectionResponse

class TargetDetectionChain:
    """
    A lightweight LLM chain designed to automatically detect the ML target column
    during the initial file upload phase based on a rapid statistical profile.
    """
    
    def __init__(self):
        self.llm = get_llm()
        self.structured_llm = self.llm.with_structured_output(TargetDetectionResponse)
        
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert Machine Learning Data Scientist. 
The user has uploaded a new dataset and did not explicitly specify the target column (the column they want to predict).

Your job is to look at the light statistical schema of the dataset and deduce the most probable target column for a Classification or Regression model.

HEURISTICS TO FOLLOW:
1. Classification Targets: Often have a few unique string values like ['Yes', 'No'], ['Survived', 'Died'], ['Cat', 'Dog', 'Bird'], or simple binary numeric values like [0, 1]. Look out for keywords like 'target', 'class', 'label', 'churn', etc.
2. Regression Targets: Typically continuous numeric values. Look for keywords like 'price', 'salary', 'revenue', 'score'.
3. ID/Index Columns: DO NOT select columns with very high cardinality (unique count ~ total rows) like 'PassengerId', 'uuid', or 'Index'. They are just identifiers.
4. If multiple columns look like targets, pick the most conventional one (often the last column in academic datasets, or clearly named 'target', 'price', etc).

You will receive a JSON describing the columns: name, datatype, unique count, and a sample of unique values (if cardinality < 20).
Analyze the metadata logically and output the exact name of the best candidate target column.
"""),
            ("human", "Here is the dataset metadata:\n{metadata}")
        ])
        
    def detect_target(self, column_metadata: list) -> str:
        """
        Takes a list of dictionaries containing basic column stats and asks the LLM
        to decide the target column. Returns the column name.
        """
        try:
            chain = self.prompt | self.structured_llm
            metadata_str = json.dumps(column_metadata, indent=2)
            
            response: TargetDetectionResponse = chain.invoke({"metadata": metadata_str})
            return response.target_column
            
        except Exception as e:
            # If the LLM throws an error (e.g. rate limit), bubble it up so the caller can fallback
            raise RuntimeError(f"LLM Target Detection Failed: {str(e)}")
