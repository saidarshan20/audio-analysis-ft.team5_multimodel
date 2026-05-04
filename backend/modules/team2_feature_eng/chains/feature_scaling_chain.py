"""
feature_scaling_chain.py - Stage 4: Normalize Feature Ranges

PURPOSE:
  Ask the AI to scale numeric columns so they are all on a comparable
  scale (e.g., 0-1 or mean=0, std=1). This is required for many ML models.

WHY SCALING MATTERS:
  If one column is 'age' (values 20-80) and another is 'income' (values 20000-200000),
  a model like K-Nearest Neighbors or Neural Network will always prioritize income
  just because the numbers are larger — even if age is equally important.
  Scaling removes this numerical bias.

WHAT THE AI DOES:
  Reads 'outlier_percent' and 'skew' for each column and recommends:
  - StandardScaler: for normally distributed columns (mean=0, std=1)
  - MinMaxScaler: for uniformly distributed or bounded columns (0 to 1)
  - RobustScaler: for columns with many outliers (uses median and IQR, not mean)

INHERITS FROM: BaseFeatureChain (see base_chain.py)
"""

from langchain_core.prompts import ChatPromptTemplate
from .base_chain import BaseFeatureChain


class FeatureScalingChain(BaseFeatureChain):
    """
    Stage 4: Feature Scaling
    Normalizes numeric columns to comparable ranges for ML training.
    """

    def _build_prompt_template(self) -> ChatPromptTemplate:
        system_prompt = """You are a senior Machine Learning Preprocessing Engineer.
Your only job for this task is to suggest the optimal SCALING strategy for numeric columns.

## DATASET INFORMATION
Target Column (what we want to predict): {target_column}
Dataset Description: {dataset_description}

Available Columns and Their Statistics (focus on 'skew', 'outlier_percent', 'mean', 'std'):
{column_info}

Sample Data (first 5 rows):
{sample_data}

## YOUR TASK
Generate exactly {num_suggestions} scaling suggestions for NUMERIC columns. Use this decision logic:

DECISION TREE FOR CHOOSING A SCALER:
  1. → Is outlier_percent HIGH (> 2%)? → Use RobustScaler
     (RobustScaler uses median and IQR so outliers don't distort the scale)
     
  2. → Is skew LOW (|skew| < 1) and outlier_percent LOW (< 2%)? → Use StandardScaler
     (StandardScaler centers at 0 and scales to unit variance — works best for normal data)
     
  3. → Is the column bounded or representing a percentage/rate? → Use MinMaxScaler
     (MinMaxScaler maps to [0, 1] — good for columns with known min/max limits)

FOR EACH SUGGESTION:
  - Pick one NUMERIC column from the column list
  - Apply the appropriate scaler chosen from the decision tree above
  - Store the result in a NEW column (DO NOT overwrite the original!)
  - Name new column with suffix: _standardized, _normalized, _robust

CODE RULES:
  - DataFrame variable is always `df`
  - Available scalers: StandardScaler, MinMaxScaler, RobustScaler
  - Sklearn scalers need a 2D array — use df[['col']] (double brackets!)
  - Handle NaNs before scaling: .fillna(df['col'].median())
  - Example: df['age_standardized'] = StandardScaler().fit_transform(df[['age']].fillna(df['age'].median())).flatten()

5. CREATE UNIQUE feature codes with prefix FS_ (e.g., FS_001, FS_002).

ANTI-HALLUCINATION RULES:
❌ Do NOT scale the target column '{target_column}'
❌ Do NOT scale categorical/text columns
❌ Do NOT use columns that are not in the column list
❌ Do NOT suggest log/sqrt transforms (that's Stage 2)
❌ Do NOT suggest PCA (that's Stage 3)
❌ Do NOT suggest dropping columns (that's Stage 5)
✅ ONLY apply StandardScaler, MinMaxScaler, or RobustScaler to numeric columns
"""

        return ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "Analyze the column stats and generate {num_suggestions} scaling suggestions.")
        ])
