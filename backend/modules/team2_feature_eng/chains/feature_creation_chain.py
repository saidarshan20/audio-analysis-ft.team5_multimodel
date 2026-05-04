"""
feature_creation_chain.py - Stage 1: Generate Brand New Features

PURPOSE:
  Ask the AI to create entirely new columns by combining existing ones.
  Examples: price_per_sqft = price / area, total_rooms = bedrooms + bathrooms

WHAT THE AI DOES:
  - Reads column names, types, and sample data
  - Identifies meaningful combinations (ratios, products, differences, polynomials)
  - Outputs executable Pandas code for each new feature

INHERITS FROM: BaseFeatureChain (see base_chain.py)
  We only need to define the prompt here — all chain logic is in the base class.
"""

from langchain_core.prompts import ChatPromptTemplate
from .base_chain import BaseFeatureChain


class FeatureCreationChain(BaseFeatureChain):
    """
    Stage 1: Feature Creation
    Generates new columns by mathematically combining existing ones.
    """

    def _build_prompt_template(self) -> ChatPromptTemplate:
        system_prompt = """You are a senior Data Scientist specializing in Feature Engineering.
Your only job for this task is to CREATE new predictive features by combining existing columns.

## DATASET INFORMATION
Target Column (what we want to predict): {target_column}
Dataset Description: {dataset_description}

Available Columns and Their Statistics:
{column_info}

Sample Data (first 5 rows):
{sample_data}

## YOUR TASK
Generate exactly {num_suggestions} NEW feature ideas. Each feature must:

1. COMBINE existing columns mathematically (ratio, product, difference, polynomial).
   Good ideas: price/area, bedrooms+bathrooms, income^2, log(price)/area
   
2. MAKE DOMAIN SENSE for predicting '{target_column}'.
   Think: what derived numbers would a human analyst create?

3. USE ONLY columns that appear exactly in the column list above.
   NEVER invent column names. Copy them character-for-character.

4. PRODUCE CLEAN PANDAS CODE following these rules:
   - DataFrame variable is always `df`
   - Only use `pd` (pandas) and `np` (numpy)
   - Handle division-by-zero: use `.replace(0, np.nan)` before dividing
   - Handle missing values: chain `.fillna(0)` at the end
   - Example: df['price_per_area'] = (df['price'] / df['area'].replace(0, np.nan)).fillna(0)

5. CREATE UNIQUE feature codes with prefix FC_ (e.g., FC_001, FC_002).

ANTI-HALLUCINATION RULES:
❌ Do NOT use columns that are not in the column list
❌ Do NOT suggest log transforms (that's Stage 2)
❌ Do NOT suggest scalers (that's Stage 3)
❌ Do NOT suggest dropping columns (that's Stage 5)
✅ ONLY create NEW combined features
"""

        return ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "Generate {num_suggestions} new feature creation suggestions for this dataset.")
        ])
