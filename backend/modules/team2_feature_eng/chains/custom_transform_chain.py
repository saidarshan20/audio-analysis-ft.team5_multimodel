import pandas as pd
from typing import Dict, Any, List
from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate
from ..llm.llm_provider import get_llm

class CustomTransformCode(BaseModel):
    """Schema for the LLM output containing generated pandas operations"""
    reasoning: str = Field(description="Reasoning behind the generated code")
    python_code: str = Field(description="Executable pandas code altering the dataframe 'df'")

class CustomTransformChain:
    """LangChain orchestration for generating custom pandas transformations"""
    def __init__(self):
        self.llm = get_llm()
        self.structured_llm = self.llm.with_structured_output(CustomTransformCode)
        
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert Data Engineer AI module. 
Your task is to take a natural language request and the current dataframe schema, and return precise, executable pandas code that performs the requested transformation.
Assume the dataframe is available as `df`. Assume `pd` and `np` are imported.
Do NOT attempt to read files, fetch external data, or perform destructive operations outside of the requested transformation.
Focus strictly on vectorised pandas operations where possible.
"""),
            ("human", """Here is the current dataframe schema info:
{schema_info}

User Request: {user_prompt}""")
        ])
        
    def generate_code(self, schema_info: str, user_prompt: str) -> str:
        chain = self.prompt | self.structured_llm
        try:
            response: CustomTransformCode = chain.invoke({
                "schema_info": schema_info,
                "user_prompt": user_prompt
            })
            return response.python_code
        except Exception as e:
            raise Exception(f"Failed to generate transformation code: {str(e)}")
