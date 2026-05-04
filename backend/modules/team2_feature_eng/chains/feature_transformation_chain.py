"""
feature_transformation_chain.py - Stage 2: Fix Skewed Distributions

PURPOSE:
  Ask the AI to identify numeric columns with skewed distributions and
  apply mathematical transformations to make them more normal (bell-shaped).

WHY SKEWNESS MATTERS:
  Many ML models (Linear Regression, SVMs, Neural Networks) perform much better
  when input features follow a roughly normal distribution.
  A skewness value of |skew| > 1 means the data is significantly skewed.

WHAT THE AI DOES:
  Reads the 'skew' metric for each column and suggests:
  - Log transformation (np.log1p) for positive skew with no zeros
  - Square root (np.sqrt) for moderate positive skew
  - Yeo-Johnson (scipy.stats.yeojohnson, via rank transform) for data with zeros/negatives
  - Rank transformation (df.rank(pct=True)) for extreme or unknown distributions

INHERITS FROM: BaseFeatureChain (see base_chain.py)
"""

from langchain_core.prompts import ChatPromptTemplate
from .base_chain import BaseFeatureChain


class FeatureTransformationChain(BaseFeatureChain):
    """
    Stage 2: Feature Transformation
    Fixes skewed distributions using mathematical transformations.
    """

    def _build_prompt_template(self) -> ChatPromptTemplate:
        system_prompt = """You are a senior Data Scientist specializing in Statistical Distribution Normalization.
Your only job for this task is to suggest mathematical TRANSFORMATIONS to reduce skewness in numeric columns.

## DATASET INFORMATION
Target Column (what we want to predict): {target_column}
Dataset Description: {dataset_description}

Available Columns and Their Statistics (focus on 'skew' and 'outlier_percent'):
{column_info}

Sample Data (first 5 rows):
{sample_data}

## YOUR TASK
Generate exactly {num_suggestions} transformation suggestions. Each suggestion must:

1. TARGET A SKEWED COLUMN — look for columns in column_info where |skew| > 0.75.
   Higher skew = higher priority.

2. CHOOSE THE RIGHT MATH based on the data:
   - Positive skew + all values ≥ 0: Use np.log1p(df['col'].clip(lower=0))
   - Positive skew + values can be 0: Use np.sqrt(df['col'].clip(lower=0))
   - Negative skew OR values can be negative: Use df['col'].rank(pct=True)
   - Extreme outliers (outlier_percent > 5%): Use df['col'].clip(lower=Q1, upper=Q3)

3. CREATE A NEW COLUMN — do NOT overwrite the original!
   Name it with a clear suffix: _log1p, _sqrt, _rank, _clipped

4. PRODUCE CLEAN PANDAS CODE following these rules:
   - DataFrame variable is always `df`
   - Only use `pd` (pandas) and `np` (numpy)
   - Handle missing values: fill before transforming
   - Example: df['income_log1p'] = np.log1p(df['income'].clip(lower=0)).fillna(0)

5. CREATE UNIQUE feature codes with prefix FT_ (e.g., FT_001, FT_002).

ANTI-HALLUCINATION RULES:
❌ Do NOT use columns not in the column list
❌ Do NOT suggest PCA or clustering (that's Stage 3)
❌ Do NOT suggest StandardScaler/MinMaxScaler (that's Stage 4)
❌ Do NOT suggest dropping columns (that's Stage 5)
✅ ONLY apply transformations (log, sqrt, rank, clip) to correct skewness
"""

        return ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "Analyze the skewness values and generate {num_suggestions} transformation suggestions.")
        ])
