"""
base_chain.py - The Blueprint for All Feature Engineering Chains

WHY THIS FILE EXISTS:
All 5 feature engineering stages (Creation, Transformation, Extraction,
Scaling, Selection) share the same structure:
  1. Connect to the LLM
  2. Send a prompt with dataset statistics
  3. Get back structured Python code suggestions
  4. Allow the user to regenerate any single suggestion

Instead of repeating this logic 5 times (and having 5 bugs instead of 1),
this BaseFeatureChain defines the common behaviour ONCE.

HOW TO USE:
  Each stage only needs to implement `_build_prompt_template()` to define
  what it specifically asks the AI to do. Everything else is inherited.
"""

import json
from abc import ABC, abstractmethod
from typing import Dict, Any

from langchain_core.prompts import ChatPromptTemplate

from ..llm.llm_provider import get_llm
from ..schemas import LLMSuggestionsResponse, FeatureSuggestion


class BaseFeatureChain(ABC):
    """
    Abstract base class for all feature engineering LangChain stages.

    Subclasses only need to implement `_build_prompt_template()`.
    All other logic (LLM connection, suggestion generation, regeneration)
    is handled here.
    """

    def __init__(self):
        # ─── Connect to the LLM ───────────────────────────────────────────────
        # get_llm() reads from .env and picks Azure / OpenAI / Gemini automatically.
        # No hardcoded model names here!
        self.llm = get_llm()

        # For generating a BATCH of suggestions → returns LLMSuggestionsResponse
        self.structured_llm_batch = self.llm.with_structured_output(LLMSuggestionsResponse)

        # For REGENERATING one specific suggestion → returns a single FeatureSuggestion
        self.structured_llm_single = self.llm.with_structured_output(FeatureSuggestion)

        # Each subclass defines its own system prompt
        self.prompt = self._build_prompt_template()

    @abstractmethod
    def _build_prompt_template(self) -> ChatPromptTemplate:
        """
        Subclasses MUST implement this to define their specialized system prompt.
        The prompt should accept these template variables:
          - {target_column}
          - {column_info}      (JSON string of column stats)
          - {sample_data}      (JSON string of first 5 rows)
          - {dataset_description}
          - {num_suggestions}
        Optional (only for extraction/selection):
          - {correlation_data}
        """
        pass

    def generate_suggestions(
        self,
        column_info: Dict[str, Any],
        sample_data: Dict[str, Any],
        target_column: str,
        num_suggestions: int,
        dataset_description: str = "",
        correlation_data: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        """
        Calls the LLM and returns a list of feature suggestions.

        Args:
            column_info: Dict mapping column name → stats (mean, skew, missing%, etc.)
            sample_data: Dict of first 5 rows {column: [val1, val2, ...]}
            target_column: The ML target column we're trying to predict
            num_suggestions: How many feature ideas to generate
            dataset_description: Free-text summary of the dataset
            correlation_data: Optional correlation matrix (needed by extraction/selection)

        Returns:
            Dict with key "suggestions" → list of FeatureSuggestion dicts
        """
        # Build the input for the prompt template
        prompt_input = {
            "target_column": target_column,
            # Serialize to JSON strings so the LLM can read them clearly
            "column_info": json.dumps(column_info, indent=2, default=str),
            "sample_data": json.dumps(sample_data, indent=2, default=str),
            "dataset_description": dataset_description,
            "num_suggestions": num_suggestions,
        }

        # Only include correlation_data if the prompt uses it
        if correlation_data is not None:
            prompt_input["correlation_data"] = json.dumps(correlation_data, indent=2, default=str)

        # Build and run the chain: prompt → LLM → parsed Pydantic output
        chain = self.prompt | self.structured_llm_batch
        response: LLMSuggestionsResponse = chain.invoke(prompt_input)

        # Return as a plain dict (easier to work with in services.py)
        return response.model_dump()

    def regenerate_suggestion(
        self,
        feature_code: str,
        current_code: str,
        current_reasoning: str,
        modification_request: str,
    ) -> Dict[str, Any]:
        """
        Rewrites ONE existing suggestion based on plain-English user instructions.

        This uses a fixed regeneration prompt so the user doesn't have to know
        how to write Pandas code — they just describe what they want changed.

        Args:
            feature_code: The unique identifier like "FC_001" (must stay the same)
            current_code: The Python code that was previously generated
            current_reasoning: The AI's original reasoning for this feature
            modification_request: The user's plain-English instruction (e.g. "use log instead of sqrt")

        Returns:
            Dict matching FeatureSuggestion schema
        """
        # Fixed regeneration prompt — same for ALL stages
        regen_prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert Data Scientist modifying an existing feature engineering code.

EXISTING FEATURE TO MODIFY:
- Feature Code: {feature_code}
- Current Reasoning: {current_reasoning}
- Current Python Code:
{current_code}

USER'S MODIFICATION REQUEST:
{modification_request}

STRICT RULES (follow exactly):
1. Keep the exact same `feature_code` value.
2. Only use: pandas (`pd`), numpy (`np`), sklearn scalers, scipy.stats (`stats`), PCA, KMeans.
3. The dataframe variable is ALWAYS named `df`.
4. Handle missing values with `.fillna()` before any computation.
5. DO NOT invent new column names. Only reference columns that appear in the current code.
6. DO NOT use `inplace=True` for drops — always use reassignment: `df = df.drop(...)`.
7. Output clean, single-purpose code. No comments, no print statements.
"""),
            ("human", "Please regenerate this feature according to my modification request.")
        ])

        chain = regen_prompt | self.structured_llm_single
        response: FeatureSuggestion = chain.invoke({
            "feature_code": feature_code,
            "current_code": current_code,
            "current_reasoning": current_reasoning,
            "modification_request": modification_request,
        })

        return response.model_dump() if hasattr(response, "model_dump") else response
