from .config import AI_MODE


def get_ai_service():
    if AI_MODE == "azure":
        from . import ai_azure_openai
        return ai_azure_openai
    else:
        from . import ai_huggingface
        return ai_huggingface
