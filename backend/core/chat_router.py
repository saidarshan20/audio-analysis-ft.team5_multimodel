import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List
from dotenv import load_dotenv
from openai import OpenAI, AzureOpenAI

load_dotenv()

router = APIRouter(prefix="/api/chat", tags=["Core: Chat Assistant"])

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]

# Load knowledge base
current_directory = os.path.dirname(os.path.abspath(__file__))
file_path = os.path.join(current_directory, "knowledge_base.txt")

try:
    with open(file_path, "r", encoding="utf-8") as file:
        PLATFORM_INFORMATION = file.read()
except FileNotFoundError:
    PLATFORM_INFORMATION = "Error: knowledge_base.txt not found."
    print(f"WARNING: knowledge_base.txt not found at {file_path}")


def build_messages(request_messages):
    messages = [{"role": "system", "content": PLATFORM_INFORMATION}]
    for msg in request_messages:
        role = "assistant" if msg.role == "bot" else "user"
        messages.append({"role": role, "content": msg.content})
    return messages


@router.post("/")
def chat_with_assistant(request: ChatRequest):
    openai_messages = build_messages(request.messages)

    # --- AZURE GENERATOR ---
    def azure_stream():
        client = AzureOpenAI(
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            api_version=os.getenv("AZURE_OPENAI_API_VERSION"),
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")
        )
        deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")

        response = client.chat.completions.create(
            model=deployment,
            messages=openai_messages,
            temperature=0.3,
            stream=True
        )

        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    # --- GROQ GENERATOR ---
    def groq_stream():
        client = OpenAI(
            api_key=os.getenv("GROQ_API_KEY"),
            base_url="https://api.groq.com/openai/v1",
        )
        model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

        response = client.chat.completions.create(
            model=model,
            messages=openai_messages,
            temperature=0.3,
            stream=True
        )

        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    # --- FALLBACK STREAM WRAPPER ---
    def fallback_stream():
        try:
            # Try Azure first
            for chunk in azure_stream():
                yield chunk
        except Exception as azure_error:
            print(f"⚠️ Azure failed, switching to Groq: {str(azure_error)}")
            try:
                for chunk in groq_stream():
                    yield chunk
            except Exception as groq_error:
                raise HTTPException(
                    status_code=500,
                    detail=f"Both Azure and Groq failed. Azure: {str(azure_error)} | Groq: {str(groq_error)}"
                )

    return StreamingResponse(fallback_stream(), media_type="text/plain")