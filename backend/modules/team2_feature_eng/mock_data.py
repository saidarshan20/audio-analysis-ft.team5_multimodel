# mock_data.py - Static suggestions for demo purposes when API keys are missing

MOCK_SUGGESTIONS = {
    "housing": {
        "target": "price",
        "quality": [
            {
                "id": "HOUSE_MISSING_FURNISH",
                "column": "furnishingstatus",
                "issue": "Missing Values & Typos",
                "operation": "impute_mode_and_clean",
                "display_name": "Clean Furnishing Status",
                "reason": "Found missing entries and slight variations (e.g., 'furnishe', 'sei-furnished'). Cleaning these ensures consistent categories.",
                "code": "df['furnishingstatus'] = df['furnishingstatus'].fillna('unfurnished').str.strip().str.replace('furnishe$', 'furnished', regex=True).str.replace('sei-', 'semi-', regex=True)"
            },
            {
                "id": "HOUSE_OUTLIER_AREA",
                "column": "area",
                "issue": "Extreme Outliers (16,200+)",
                "operation": "cap_outliers",
                "display_name": "Cap Area Outliers",
                "reason": "The 'area' column has extreme values that skew the distribution. Capping at the 95th percentile preserves data integrity for regression.",
                "code": "upper_limit = df['area'].quantile(0.95)\ndf.loc[df['area'] > upper_limit, 'area'] = upper_limit"
            }
        ],
        "creation": [
            {
                "feature_code": "HOUSE_BED_BATH",
                "feature_name": "Bed_Bath_Ratio",
                "description": "Calculate the ratio of bedrooms to bathrooms.",
                "reasoning": "A high bedroom-to-bathroom ratio can indicate a high-density living space, which impacts market value differently than balanced homes.",
                "python_code": "df['Bed_Bath_Ratio'] = df['bedrooms'] / df['bathrooms'].replace(0, 1)",
                "expected_benefit": "Improves model ability to distinguish between dense vs spacious layouts."
            },
            {
                "feature_code": "HOUSE_HAS_EXTRAS",
                "feature_name": "Has_Premium_Features",
                "description": "Binary flag for homes with Guestroom, Basement, and Air Conditioning.",
                "reasoning": "Luxury homes often have all three. This captures the synergistic effect of premium amenities.",
                "python_code": "df['Has_Premium_Features'] = ((df['guestroom'] == 'yes') & (df['basement'] == 'yes') & (df['airconditioning'] == 'yes')).astype(int)",
                "expected_benefit": "Provides a strong single signal for premium status, simplifying tree splits."
            }
        ],
        "transformation": [
            {
                "feature_code": "HOUSE_TRANS_1",
                "feature_name": "Price_Per_Area",
                "description": "Calculate the ratio of price per square foot (area).",
                "reasoning": "Price per area is a standard real estate metric that normalizes value across different property sizes.",
                "python_code": "df['Price_Per_Area'] = df['price'] / df['area']",
                "expected_benefit": "Normalizes price, providing a more robust target variable or strong feature."
            },
            {
                "feature_code": "HOUSE_AREA_LOG",
                "feature_name": "Area_Log",
                "description": "Apply logarithmic transformation to the area column.",
                "reasoning": "Area is right-skewed. Log transformation makes the distribution more normal, helping linear regression models.",
                "python_code": "import numpy as np\ndf['Area_Log'] = np.log1p(df['area'])",
                "expected_benefit": "Reduces skewness, making the feature more suitable for linear models."
            }
        ],
        "extraction": [
            {
                "feature_code": "HOUSE_FURNISH_ENC",
                "feature_name": "Furnish_Level",
                "description": "Ordinal encoding for furnishing status (0=Unfurnished, 1=Semi, 2=Full).",
                "reasoning": "Converting categorical status to an ordered scale allows the model to learn the value progression of furnishing.",
                "python_code": "furnish_map = {'unfurnished': 0, 'semi-furnished': 1, 'furnished': 2}\ndf['Furnish_Level'] = df['furnishingstatus'].map(furnish_map).fillna(0)",
                "expected_benefit": "Retains ordinal relationship, which is lost in one-hot encoding."
            }
        ],
        "scaling": [
            {
                "feature_code": "HOUSE_SCALE_PRICE",
                "feature_name": "Price_Standardized",
                "description": "Standardize the price using Z-score normalization.",
                "reasoning": "Scaling the target and large numeric inputs to a zero-mean range improves convergence for gradient-based learners.",
                "python_code": "from sklearn.preprocessing import StandardScaler\nscaler = StandardScaler()\ndf['Price_Standardized'] = scaler.fit_transform(df[['price']])",
                "expected_benefit": "Ensures distance-based algorithms and gradient descent converge efficiently."
            }
        ],
        "selection": [
             {
                "feature_code": "HOUSE_DROP_MAINROAD",
                "feature_name": "Drop Mainroad",
                "description": "Remove the mainroad binary column.",
                "reasoning": "In this specific dataset, 90%+ homes are on the main road, providing very little variance/signal for prediction.",
                "python_code": "df = df.drop(columns=['mainroad'])",
                "expected_benefit": "Reduces dimensionality and noise by removing near-zero variance features."
            }
        ]
    }
}
