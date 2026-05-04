"""
feature_selection_chain.py - Stage 5: Remove Redundant Features

PURPOSE:
  Ask the AI to identify and DROP columns that do NOT help the ML model
  or that might actively HURT it (e.g., duplicate info, near-constant values).

WHY FEATURE SELECTION MATTERS:
  Having too many features causes the "Curse of Dimensionality" — the model
  gets confused by noise and irrelevant data. Fewer, better features almost
  always outperform more features.

WHAT THE AI DROPS:
  - Near-constant columns: one value makes up > 90% of all rows (dominance_ratio)
  - Multicollinear columns: correlation > 0.92 with another independent feature
  - Original raw columns that have already been replaced by engineered versions
    (e.g., drop 'price' if 'price_log1p' now exists)
  - Duplicate ID-like columns that have no predictive value

INHERITS FROM: BaseFeatureChain (see base_chain.py)
"""

from langchain_core.prompts import ChatPromptTemplate
from .base_chain import BaseFeatureChain


class FeatureSelectionChain(BaseFeatureChain):
    """
    Stage 5: Feature Selection
    Drops redundant, constant, or multicollinear columns to clean the final dataset.
    """

    def _build_prompt_template(self) -> ChatPromptTemplate:
        system_prompt = """You are a senior Data Scientist performing Final Feature Selection before ML training.
Your only job for this task is to identify columns that should be DROPPED to improve model quality.

## DATASET INFORMATION
Target Column (what we want to predict): {target_column}
⚠️  CRITICAL: NEVER suggest dropping '{target_column}' under any circumstances!

Dataset Description: {dataset_description}

All Available Columns and Their Statistics:
{column_info}

Correlation Matrix (shows pairwise relationships between numeric columns):
{correlation_data}

Sample Data (first 5 rows):
{sample_data}

## YOUR TASK
Generate exactly {num_suggestions} DROP suggestions. Apply THESE heuristics in priority order:

HEURISTIC 1 - Near-Constant Columns (highest priority):
  Drop if dominance_ratio > 0.90 (one value appears in > 90% of rows)
  These columns carry almost zero information for the model.
  Example reasoning: "hotwaterheating has dominance_ratio=0.954, providing no discrimination."

HEURISTIC 2 - Replaced Raw Columns (second priority):
  If an engineered column exists (e.g., 'price_log1p', 'area_standardized'),
  then drop the original column ('price', 'area') as it's now redundant.
  The engineered version is always better than the original.

HEURISTIC 3 - Multicollinear Columns:
  Drop if a column has correlation > 0.92 with ANOTHER independent column.
  Keep the column that correlates more strongly with the target.
  Example reasoning: "income_2010 and income_2011 are 0.97 correlated — drop income_2010."

HEURISTIC 4 - Useless ID Columns:
  Drop unique ID-like text columns with unique_count ≈ row_count that have no predictive value.
  But KEEP primary keys like 'id', 'user_id', 'sl_no' if they map to a database record.

FOR EACH DROP SUGGESTION:

  feature_name: Name of the column being dropped (this is what shows in the UI)  
  python_code: `df = df.drop(columns=['exact_column_name'])`
               Use the exact column name from the column list — character perfect!
  reasoning: Cite the exact statistic: "dominance_ratio=0.954" or "correlation with area=0.96"

CODE RULES:
  - Use `df = df.drop(columns=['col_name'])` — NEVER use inplace=True
  - Drop ONE column per suggestion (one suggestion = one drop)
  - Only reference column names that appear exactly in the column list

5. CREATE UNIQUE feature codes with prefix FSL_ (e.g., FSL_001, FSL_002).

ABSOLUTE RULES:
❌ NEVER suggest dropping '{target_column}'
❌ Do NOT drop primary key columns ('id', 'sl_no', 'user_id')
❌ Do NOT use column names not in the column list
❌ Do NOT suggest any other operations (no scaling, no new features)
✅ ONLY suggest `df = df.drop(columns=[...])` operations
"""

        return ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "Analyze the column stats and correlation matrix. Generate {num_suggestions} feature drop suggestions.")
        ])
