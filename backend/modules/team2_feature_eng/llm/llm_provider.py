import os
from dotenv import load_dotenv
import pathlib

# Safety: resolve .env from repo root regardless of working directory
load_dotenv(dotenv_path=pathlib.Path(__file__).parent.parent.parent.parent / ".env", override=True)


def get_llm():
    """
    Returns the best available LLM in this priority:
    1. Azure OpenAI
    2. OpenAI
    3. Gemini
    """

    # ===== 1. AZURE OPENAI =====
    azure_key = os.getenv("AZURE_OPENAI_API_KEY")
    azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    azure_deployment = os.getenv("AZURE_DEPLOYMENT_NAME")
    
    if azure_key and azure_endpoint and azure_deployment:
        from langchain_openai import AzureChatOpenAI

        return AzureChatOpenAI(
            azure_endpoint=azure_endpoint,
            deployment_name=azure_deployment,
            api_key=azure_key,
            api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2023-05-15"),
            temperature=0.2
        )

    # ===== 2. OPENAI =====
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key:
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model="gpt-4o-mini",
            api_key=openai_key,
            temperature=0.2
        )

    # ===== 3. GEMINI =====
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(
            model="gemini-flash-lite-latest",
            google_api_key=gemini_key,
            temperature=0.2
        )

    # ===== 4. FALLBACK =====
    raise Exception("❌ No LLM API key found. Add OpenAI/Azure/Gemini in .env")

