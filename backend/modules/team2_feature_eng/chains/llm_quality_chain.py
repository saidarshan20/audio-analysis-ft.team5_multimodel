import json
from typing import Dict, Any, List
from ..llm.llm_provider import get_llm
from langchain_core.prompts import ChatPromptTemplate
from ..schemas import DataQualityResponse, QualityFix

class DataQualityChain:
    """
    LangChain orchestration for Data Quality fixes using Structured Outputs.
    """
    
    def __init__(self, model_name: str = "gpt-4o-mini", temperature: float = 0.1):
        # 1. Initialize the LLM (Low temperature for highly analytical tasks)
        self.llm = get_llm()
        
        # 2. Bind the LLM directly to the Pydantic schema
        self.structured_llm = self.llm.with_structured_output(DataQualityResponse)
        
        # 3. Build the prompt
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert Senior Data Scientist AI module responsible for comprehensive data quality analysis and cleaning.
I will provide you with the full data profiling JSON. You must analyze it across ALL 7 Data Quality Dimensions and suggest precise, executable fixes.

Assume the dataframe is available in memory as a variable named `df`. Use `pd` for pandas and `np` for numpy.

═══════════════════════════════════════════════════════════════
## COLUMN TYPES IN THE PROFILE
═══════════════════════════════════════════════════════════════
Each column in `column_details` has:
- Common: column, dtype, unique, missing, missing_percent, dominance_ratio
- Numeric (int64/float64): mean, median, std, min, max, skew, outlier_percent, q1, q3, has_negatives, zero_count, zero_percent, cv
- Categorical (object/category): col_type="categorical", top_values, mode, mode_frequency_percent, cardinality, cardinality_ratio, has_whitespace_issues, has_mixed_case, has_empty_strings

═══════════════════════════════════════════════════════════════
## DIMENSION 1: COMPLETENESS (Missing Values)
═══════════════════════════════════════════════════════════════

### NUMERIC columns:
- missing < 5% + symmetric (|skew| < 1): fill_mean
- missing < 5% + skewed (|skew| > 1): fill_median
- 5-15% missing: fill_median or fill_knn (KNN is better when correlated features exist)
- 15-30% missing: fill_knn + add_missing_flag (KNN leverages feature relationships; flag preserves missingness signal)
- 30-50% missing: fill_median + add_missing_flag (KNN may be unreliable with too many missing)
- > 50% missing: drop_column (too sparse to impute reliably)
- Near-zero variance (std ≈ 0): drop_column (no predictive signal)
- Time-series / ordered data: fill_interpolate (linear interpolation preserves trends)
- Grouped structure (e.g. city→price): fill_grouped_mean or fill_grouped_median

⚠️ BIAS AWARENESS FOR NUMERIC:
- fill_mean shifts variance downward — avoid when outlier_percent > 10%
- fill_median is robust but creates artificial density at the median
- fill_knn preserves local relationships — preferred when correlation exists between columns
- fill_interpolate is ideal for sequential/time-ordered data
- Always pair high-missing imputation (>15%) with add_missing_flag

### CATEGORICAL columns:
- missing < 3% + strong dominant mode (mode_frequency_percent > 60%): fill_mode_cat
- missing < 3% + no dominant mode: fill_random_sample (randomly sample from existing distribution — prevents mode bias)
- 3-15% + mode_frequency_percent > 60%: fill_mode_cat + add_missing_flag
- 3-15% + mode_frequency_percent < 60%: fill_random_sample (preserves original distribution balance)
- 3-15% + low cardinality (< 5 categories): fill_proportional (weighted random fill matching category proportions)
- 15-40% missing: fill_unknown (create explicit "Unknown" — missingness is likely informative at this scale)
- > 40% missing: fill_unknown OR drop_column
- cardinality_ratio > 0.5 (near-unique like names/IDs): fill_unknown (mode/random imputation is meaningless)
- Ordered/temporal categories: fill_ffill or fill_bfill (forward/backward fill preserves order)
- When related columns exist (e.g. country→city): fill_grouped_mode (fill with mode per group)

⚠️ BIAS AWARENESS FOR CATEGORICAL:
- fill_mode_cat inflates the dominant category — AVOID when mode_frequency_percent < 40% or missing > 10%
- fill_random_sample preserves the original distribution proportions — best for moderate missing
- fill_proportional ensures each category maintains its original share — best for low-cardinality columns
- fill_unknown is safest for high missing rates — lets the model learn that "unknown" is a distinct signal
- fill_grouped_mode leverages related features — best when a logical grouping column exists

═══════════════════════════════════════════════════════════════
## DIMENSION 2: ACCURACY (Outliers & Impossible Values)  
═══════════════════════════════════════════════════════════════
- outlier_percent > 5%: clip (winsorize to Q1-1.5*IQR / Q3+1.5*IQR)
- outlier_percent > 15%: clip + add_missing_flag (flag extreme rows)
- has_negatives=true on columns that SHOULD be non-negative (e.g. age, price, count): clip_lower_zero
- zero_percent > 50% on a non-binary column: flag as suspicious, consider add_missing_flag
- Extreme skew |skew| > 2 + outliers: log_transform (normalizes distribution)
- cv > 3 (coefficient of variation): investigate extreme spread, clip outliers

═══════════════════════════════════════════════════════════════
## DIMENSION 3: CONSISTENCY (Contradictions & Formatting)
═══════════════════════════════════════════════════════════════
- has_mixed_case=true: standardize_case (e.g. "Yes"/"YES"/"yes" → "yes")
- has_whitespace_issues=true: strip_whitespace (trim leading/trailing spaces)
- has_empty_strings=true: replace_empty_with_nan + then apply missing value strategy
- Inconsistent categories in top_values (same meaning, different spelling): standardize_values

═══════════════════════════════════════════════════════════════
## DIMENSION 4: VALIDITY (Type & Format Conformity)
═══════════════════════════════════════════════════════════════
- Numeric column with negative values where domain expects positive-only: clip_lower_zero  
- Categorical with dtype=object but looks numeric: cast_to_numeric
- Column with 1-2 unique values + high dominance_ratio (> 0.95): drop_column (zero-variance, no signal)
- Binary column stored as string ("Yes"/"No"): encode_binary

═══════════════════════════════════════════════════════════════
## DIMENSION 5: UNIQUENESS (Deduplication)
═══════════════════════════════════════════════════════════════
NOTE: Exact and fuzzy duplicate detection is handled separately by the system.
Do NOT suggest duplicate removal — it is automated. 
Focus on other dimensions.

═══════════════════════════════════════════════════════════════
## DIMENSION 6: TIMELINESS (Freshness)
═══════════════════════════════════════════════════════════════
- If datetime columns exist and have missing values, apply fill_ffill (forward fill)
- This dimension is mostly handled by the data source; no aggressive fixes needed

═══════════════════════════════════════════════════════════════
## DIMENSION 7: INTEGRITY (Referential / Structural)
═══════════════════════════════════════════════════════════════
- Column with cardinality=1 (only one unique value): drop_column (constant, no information)
- Column with dominance_ratio > 0.98: drop_column (near-constant, negligible variance)
- ID/index columns (cardinality_ratio ≈ 1.0, all unique): drop_column (not a feature)

═══════════════════════════════════════════════════════════════
## ALLOWED OPERATIONS (use exact operation keys)
═══════════════════════════════════════════════════════════════

### Numeric Imputation (Simple):
1. fill_mean — df['col'] = df['col'].fillna(df['col'].mean())
2. fill_median — df['col'] = df['col'].fillna(df['col'].median())
3. fill_mode — df['col'] = df['col'].fillna(df['col'].mode()[0])
4. fill_zero — df['col'] = df['col'].fillna(0)
5. fill_interpolate — df['col'] = df['col'].interpolate(method='linear')

### Numeric Imputation (Advanced — less bias):
6. fill_knn — from sklearn.impute import KNNImputer; imputer = KNNImputer(n_neighbors=5); df[numeric_cols] = pd.DataFrame(imputer.fit_transform(df[numeric_cols]), columns=numeric_cols)
7. fill_grouped_mean — df['col'] = df.groupby('group_col')['col'].transform(lambda x: x.fillna(x.mean()))
8. fill_grouped_median — df['col'] = df.groupby('group_col')['col'].transform(lambda x: x.fillna(x.median()))
9. fill_iterative — from sklearn.experimental import enable_iterative_imputer; from sklearn.impute import IterativeImputer; imputer = IterativeImputer(max_iter=10, random_state=42); df[numeric_cols] = pd.DataFrame(imputer.fit_transform(df[numeric_cols]), columns=numeric_cols)

### Categorical Imputation (Simple):
10. fill_mode_cat — df['col'] = df['col'].fillna(df['col'].mode()[0])
11. fill_unknown — df['col'] = df['col'].fillna('Unknown')
12. fill_ffill — df['col'] = df['col'].ffill()
13. fill_bfill — df['col'] = df['col'].bfill()

### Categorical Imputation (Advanced — less bias):
14. fill_random_sample — mask = df['col'].isnull(); df.loc[mask, 'col'] = df['col'].dropna().sample(n=mask.sum(), replace=True, random_state=42).values
15. fill_proportional — cats = df['col'].dropna().value_counts(normalize=True); mask = df['col'].isnull(); df.loc[mask, 'col'] = np.random.choice(cats.index, size=mask.sum(), p=cats.values)
16. fill_grouped_mode — df['col'] = df.groupby('group_col')['col'].transform(lambda x: x.fillna(x.mode()[0] if len(x.mode()) > 0 else 'Unknown'))

### Missing Indicator:
17. add_missing_flag — df['col_is_missing'] = df['col'].isnull().astype(int)

### Outlier Handling:
18. clip — (compute Q1, Q3, IQR in code) df['col'] = df['col'].clip(lower=Q1-1.5*IQR, upper=Q3+1.5*IQR)
19. clip_lower_zero — df['col'] = df['col'].clip(lower=0)
20. log_transform — df['col_log'] = np.log1p(df['col'].clip(lower=0))
21. winsorize — df['col'] = df['col'].clip(lower=df['col'].quantile(0.01), upper=df['col'].quantile(0.99))

### Consistency Fixes:
22. standardize_case — df['col'] = df['col'].str.lower().str.strip()
23. strip_whitespace — df['col'] = df['col'].str.strip()
24. replace_empty_with_nan — df['col'] = df['col'].replace(r'^\\s*$', np.nan, regex=True)
25. standardize_values — df['col'] = df['col'].str.lower().str.strip().replace(mapping_dict)  (provide a dict of old_value: new_value pairs)

### Validity Fixes:
26. cast_to_numeric — df['col'] = pd.to_numeric(df['col'], errors='coerce')
27. encode_binary — df['col'] = df['col'].str.lower().map(dict(yes=1, no=0, true=1, false=0))

### Column-Level:
28. drop_column — df = df.drop(columns=['col'])
29. drop_rows — df = df.dropna(subset=['col'])

═══════════════════════════════════════════════════════════════
## STRICT RULES
═══════════════════════════════════════════════════════════════
- Analyze ALL columns — both numeric AND categorical
- Check ALL 7 quality dimensions, not just missing values
- Only suggest fixes where the data actually shows issues
- Be precise — cite the exact metric values (missing_percent, outlier_percent, etc.)
- DO NOT hallucinate column names not present in column_details
- DO NOT reference statistics not present in the profile
- Each fix must have valid, executable pandas code using `df` as the variable
- Prioritize: Completeness → Consistency → Accuracy → Validity → Integrity
- For each fix, the `issue` field must clearly state the quality dimension and problem
- The `reason` field must follow format: 'Metric (Value) | Reasoning string'

Your output must be a comprehensive, executable data quality strategy covering all detected issues.
"""),
            ("human", "Here is the raw data profiling context:\n{context}")
        ])

    def generate_quality_fixes(self, profile_data: dict) -> List[Dict[str, Any]]:
        """
        Reads the data profile, calls the LLM, and returns validated quality fixes.
        """
        llm_context = json.dumps(profile_data, indent=2)
        
        import time
        max_attempts = 4
        last_error = None
        
        for attempt in range(max_attempts):
            try:
                # Connect prompt to the structured LLM
                chain = self.prompt | self.structured_llm
                
                # Invoke the chain
                response: DataQualityResponse = chain.invoke({"context": llm_context})
                
                # Return as a list of dictionaries for FastAPI routers
                if not response or not hasattr(response, "fixes") or response.fixes is None:
                    return []
                return [fix.model_dump() for fix in response.fixes]
                
            except Exception as e:
                err_str = str(e).lower()
                last_error = e
                # Check for rate limits, high demand, internal Google errors, or parsing glitches
                if any(err in err_str for err in ["503", "429", "500", "unavailable", "overloaded", "exhausted", "timeout", "parse"]):
                    if attempt < max_attempts - 1:
                        # Exponential backoff: 1.5s, 3.0s, 6.0s
                        time.sleep(1.5 * (2 ** attempt))
                        continue
                
                # If it's a different error or we ran out of retries, raise it
                raise Exception(f"LangChain Data Quality failed on attempt {attempt + 1}: {str(e)}")
                
        raise Exception(f"LangChain Data Quality failed after {max_attempts} retries. Last error: {str(last_error)}")
            
    def regenerate_fix(self, profile_data: dict, fix_context: dict, prompt: str) -> Dict[str, Any]:
        regen_prompt = ChatPromptTemplate.from_messages([
            ("system", "You are an expert Data Scientist. The user wants to modify an existing data quality fix. Based on the data profile and the previous suggestion, output a modified QualityFix satisfying the user's instructions."),
            ("human", "Data Profile: {context}\n\nPrevious Fix: {fix_context}\n\nUser Instruction: {prompt}")
        ])
        
        structured_llm = self.llm.with_structured_output(QualityFix)
        chain = regen_prompt | structured_llm
        
        response = chain.invoke({
            "context": json.dumps(profile_data, indent=2),
            "fix_context": json.dumps(fix_context, indent=2),
            "prompt": prompt
        })
        
        return response.model_dump()
