"""
feature_extraction_chain.py - Stage 3: Extract Hidden Information

PURPOSE:
  Ask the AI to extract latent (hidden) patterns from the data using
  techniques like PCA, feature interaction ratios, and categorical encoding.

WHAT THE AI DOES:
  - Reads correlation data to find groups of correlated columns
  - Generates PCA components from highly correlated numeric groups
  - Creates interaction features (multiplication, ratios between correlated columns)
  - Encodes high-cardinality categorical columns numerically

WHY THIS STAGE EXISTS:
  Sometimes the most useful information isn't in a single column but in the
  COMBINATION or RELATIONSHIP between columns. PCA compresses correlated columns
  into a smaller set of uncorrelated "components" that capture the same variance.

INHERITS FROM: BaseFeatureChain (see base_chain.py)
"""

from langchain_core.prompts import ChatPromptTemplate
from .base_chain import BaseFeatureChain


class FeatureExtractionChain(BaseFeatureChain):
    """
    Stage 3: Feature Extraction
    Extracts latent information via PCA, interaction features, and encoding.
    """

    def _build_prompt_template(self) -> ChatPromptTemplate:
        system_prompt = """You are a senior Machine Learning Engineer specializing in Dimensionality Reduction and Feature Extraction.
Your only job for this task is to EXTRACT hidden patterns from the dataset using advanced techniques.

## DATASET INFORMATION
Target Column (what we want to predict): {target_column}
Dataset Description: {dataset_description}

Available Columns and Their Statistics:
{column_info}

Correlation Matrix (shows how numeric columns relate to each other):
{correlation_data}

Sample Data (first 5 rows):
{sample_data}

## YOUR TASK
Generate exactly {num_suggestions} extraction suggestions. Use THESE techniques:

TECHNIQUE 1 - PCA (Principal Component Analysis):
  Use when you see 3+ numeric columns with mutual correlation > 0.6 in the correlation matrix.
  This compresses them into a single component that captures their combined variance.
  Code example:
    features = ['col1', 'col2', 'col3']  # Only real column names!
    from_data = df[features].fillna(0)
    scaled = StandardScaler().fit_transform(from_data)
    pca = PCA(n_components=1)
    df['group_pca_1'] = pca.fit_transform(scaled)[:, 0]
  CRITICAL: NEVER include '{target_column}' in the PCA features list!

TECHNIQUE 2 - Interaction Ratios:
  Create ratio or product of two columns that are correlated with the target.
  Code example:
    df['area_per_bedroom'] = (df['area'] / df['bedrooms'].replace(0, np.nan)).fillna(0)

TECHNIQUE 3 - Categorical Encoding:
  For object/category columns with low unique count (< 20 unique values): use one-hot or label encoding.
  Code example:
    df['furnishing_encoded'] = LabelEncoder().fit_transform(df['furnishingstatus'].astype(str))

TECHNIQUE 4 - KMeans Clustering:
  Group rows into clusters as a new categorical feature. Useful for mixed numeric data.
  Code example:
    cluster_feats = df[['col1', 'col2']].fillna(0)
    df['cluster_label'] = KMeans(n_clusters=3, random_state=42, n_init='auto').fit_predict(cluster_feats)

RULES FOR ALL CODE:
  - DataFrame variable is always `df`
  - Available libraries: pd, np, StandardScaler, MinMaxScaler, PCA, KMeans, KBinsDiscretizer, LabelEncoder
  - DO NOT import anything — all libraries are pre-loaded
  - Handle NaNs before any sklearn operation
  - Use ONLY column names that appear exactly in the column list above
  - New column names must be descriptive and have a clear suffix

5. CREATE UNIQUE feature codes with prefix FE_ (e.g., FE_001, FE_002).

ANTI-HALLUCINATION RULES:
❌ Do NOT use columns not in the column list
❌ Do NOT include the target column '{target_column}' in PCA or KMeans
❌ Do NOT suggest log/sqrt transforms (that's Stage 2)
❌ Do NOT suggest StandardScaler as a standalone operation (that's Stage 4)
❌ Do NOT suggest dropping columns (that's Stage 5)
"""

        return ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "Analyze correlations and generate {num_suggestions} feature extraction suggestions.")
        ])
