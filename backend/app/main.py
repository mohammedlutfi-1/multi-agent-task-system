from app.database import reserve_student_ai_request, settle_student_ai_request
from uuid import uuid4
from asyncio import tasks
import os
import json
import asyncio
from contextlib import asynccontextmanager

from pathlib import Path
from pydoc import text

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi import Request
from app.provider_errors import (
    is_retryable_provider_error,
    ProviderCapacityError,
)
from app.model_policy import validate_model
from fastapi import Depends
from app.auth import verify_user
from app.student_documents import router as student_documents_router

from app.student_documents import extract_uploaded_document

from app.student_ai import (
    summarize_document,
    StudentAIError,
    MAX_SUMMARY_CHUNKS,
)

from app.document_context import chunk_document

from app.database import (
    reserve_student_ai_calls,
    get_student_ai_usage,
)

from app.database import create_collaboration_with_quota
from app.database import get_user_ai_usage
from uuid import UUID
from app.resume_worker import resume_worker
from app.collaboration_runner import run_claimed_collaboration
from app.database import (
    get_user_collaboration_tasks,
    get_user_collaboration_task,
    get_collaboration_turns,
)
from app.database import (
    save_user_api_key,
    get_user_api_keys,
    delete_user_api_key,
    get_user_provider_key,
)
from typing import Literal


# ---------------------------------------
# Environment configuration
# ---------------------------------------

load_dotenv(
    dotenv_path=Path(__file__).resolve().parent.parent / ".env"
)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

MODEL_1 = "nvidia/nemotron-3.5-lightning:free"
MODEL_2 = "inclusionai/ling-3.2-flash:free"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "openai/gpt-oss-20b"
GEMINI_MODEL = "gemini-3.5-flash-lite"
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)


# ---------------------------------------
# FastAPI application
# ---------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    worker_task = None

    auto_resume_enabled = (
        os.getenv("ENABLE_AUTO_RESUME", "false")
        .strip()
        .lower() == "true"
    )

    if auto_resume_enabled:
        worker_task = asyncio.create_task(
            resume_worker(resume_saved_collaboration)
        )

    try:
        yield

    finally:
        if worker_task is not None:
            worker_task.cancel()

            try:
                await worker_task
            except asyncio.CancelledError:
                pass

app = FastAPI(
    title="Multi-Agent AI Platform API",
    lifespan=lifespan,
)
app.include_router(student_documents_router)

@app.exception_handler(RequestValidationError)
async def safe_validation_error_handler(
    request: Request,
    exc: RequestValidationError,
):
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Invalid request data. Please check your input."
        },
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://multi-agent-task-system-1919.vercel.app", "https://multi-agent-task-system.vercel.app"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ---------------------------------------
# Request validation
# ---------------------------------------

class AIRequest(BaseModel):
    task: str = Field(min_length=1, max_length=5000)
    use_personal_keys: bool = False
    accept_provider_charges: bool = False
    selected_models: list[str] | None = None


class StudentAIRequest(BaseModel):
    use_personal_keys: bool = False
    accept_provider_charges: bool = False
    accept_document_processing: bool = False

    generation_type: Literal[
        "summary",
        "study_notes",
        "important_qa",
        "exam_answers",
        "revision",
        "mcq",
    ] = "summary"

# ---------------------------------------
# Health and configuration endpoints
# ---------------------------------------

@app.get("/health")
def health_check():
    return {"status": "ok"}
@app.get("/auth/check")
async def check_auth(user: dict = Depends(verify_user)):
    return {
        "authenticated": True,
        "user_id": user["sub"],
    }


#@app.get("/config-check")
def config_check():
    return {
        "supabase_url_configured": bool(
            os.getenv("SUPABASE_URL")
        ),
        "supabase_service_key_configured": bool(
            os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        ),
        "openrouter_configured": bool(
            os.getenv("OPENROUTER_API_KEY")
        ),
    }


# ---------------------------------------
# Shared OpenRouter model caller
# ---------------------------------------

async def call_ai_model(
    client: httpx.AsyncClient,
    model: str,
    messages: list[dict[str, str]],
    api_key: str,
    max_tokens: int = 3000,
) -> str:

    # Only explicitly approved free models are allowed.
    if model not in (MODEL_1, MODEL_2):
        raise HTTPException(
            status_code=400,
            detail="Model is not in the approved free-model list",
        )

    try:
        response = await client.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "reasoning": {
                    "enabled": False,
                },
            },
        )

        response.raise_for_status()

        data = response.json()
        print(
    "MODEL DEBUG:",
    "model =", model,
    "finish_reason =", (
        data.get("choices", [{}])[0].get("finish_reason")
        if data.get("choices") else None
    ),
    "usage =", data.get("usage"),
    flush=True,
)

        choices = data.get("choices")

        if not isinstance(choices, list) or not choices:
            raise HTTPException(
                status_code=502,
                detail=f"Model {model} returned no choices",
            )

        choice = choices[0]
        finish_reason = choice.get("finish_reason")
        message = choice.get("message") or {}
        answer = message.get("content")

        # Detect truncated or incomplete responses.
        if finish_reason == "length":
            raise HTTPException(
        status_code=502,
        detail=(
            f"Model {model} reached its token limit. "
            "The response was incomplete."
        ),
    )

        if finish_reason != "stop":
            raise HTTPException(
        status_code=502,
        detail=(
            f"Model {model} did not finish normally. "
            f"Finish reason: {finish_reason}"
        ),
    )

        if not isinstance(answer, str) or not answer.strip():
            raise HTTPException(
                status_code=502,
                detail=f"Model {model} returned an empty answer",
            )

        return answer.strip()

    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code

        if status == 429:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Model {model} is rate-limited. "
                    "Please try again later."
                ),
            ) from exc

        raise HTTPException(
            status_code=status,
            detail=f"Model {model} failed with HTTP {status}",
        ) from exc

    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Could not connect to model {model}",
        ) from exc

    except (ValueError, TypeError, KeyError, AttributeError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Model {model} returned an invalid response",
        ) from exc


# ---------------------------------------
# Single-model test endpoint
# ---------------------------------------

#@app.post("/ai/test")
async def test_ai(request: AIRequest):
    api_key = os.getenv("OPENROUTER_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OpenRouter API key is not configured",
        )

    async with httpx.AsyncClient(timeout=120) as client:
        answer = await call_ai_model(
            client=client,
            model=MODEL_1,
            messages=[
                {
                    "role": "user",
                    "content": request.task,
                }
            ],
            api_key=api_key,
            max_tokens=3000,
        )

    return {
        "model": MODEL_1,
        "answer": answer,
    }

# ---------------------------------------
# Gemini AI model caller
# ---------------------------------------

async def call_gemini_model(
    client: httpx.AsyncClient,
    messages: list[dict[str, str]],
    api_key: str,
    max_tokens: int = 1000,
) -> str:

    # Convert OpenAI-style messages to Gemini format.
    contents = []

    for message in messages:
        role = message["role"]
        content = message["content"]

        if role == "system":
            gemini_role = "user"
        elif role == "assistant":
            gemini_role = "model"
        else:
            gemini_role = "user"

        contents.append({
            "role": gemini_role,
            "parts": [{"text": content}],
        })

    try:
        response = await client.post(
            GEMINI_URL,
            headers={
                "x-goog-api-key": api_key,
                "Content-Type": "application/json",
            },
            json={
                "contents": contents,
                "generationConfig": {
                    "maxOutputTokens": max_tokens,
                },
            },
        )

        response.raise_for_status()
        data = response.json()

        candidates = data.get("candidates", [])

        if not candidates:
            raise HTTPException(
                status_code=502,
                detail="Gemini returned no candidates",
            )

        candidate = candidates[0]

        if candidate.get("finishReason") != "STOP":
            raise HTTPException(
                status_code=502,
                detail=(
                    "Gemini did not finish normally: "
                    f"{candidate.get('finishReason')}"
                ),
            )

        parts = candidate.get("content", {}).get("parts", [])

        answer = "".join(
            part.get("text", "")
            for part in parts
            if isinstance(part.get("text"), str)
        )

        if not answer.strip():
            raise HTTPException(
                status_code=502,
                detail="Gemini returned an empty answer",
            )

        return answer.strip()


    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code

        if status == 429:
            raise HTTPException(
                status_code=429,
                detail="Gemini rate limit reached.",
            ) from exc

        raise HTTPException(
            status_code=status,
            detail=f"Gemini API failed with HTTP {status}",
        ) from exc

    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=503,
            detail="Could not connect to Gemini",
        ) from exc

    except (ValueError, TypeError, KeyError, AttributeError) as exc:
        raise HTTPException(
            status_code=502,
            detail="Gemini returned an invalid response",
        ) from exc

# ---------------------------------------
# Groq AI model caller
# ---------------------------------------

async def call_groq_model(
    client: httpx.AsyncClient,
    messages: list[dict[str, str]],
    api_key: str,
    max_tokens: int = 500,
) -> str:
    try:
        response = await client.post(
            GROQ_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": GROQ_MODEL,
                "messages": messages,
                "max_completion_tokens": max_tokens,
                "reasoning_effort": "low",
            },
        )

        response.raise_for_status()
        data = response.json()

        choices = data.get("choices", [])

        if not choices:
            raise HTTPException(
                status_code=502,
                detail="Groq returned no choices",
            )

        choice = choices[0]

        if choice.get("finish_reason") != "stop":
            raise HTTPException(
                status_code=502,
                detail=(
                    "Groq did not finish normally: "
                    f"{choice.get('finish_reason')}"
                ),
            )

        answer = (choice.get("message") or {}).get("content")

        if not isinstance(answer, str) or not answer.strip():
            raise HTTPException(
                status_code=502,
                detail="Groq returned an empty answer",
            )

        return answer.strip()


    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code

        if status == 429:
            raise HTTPException(
                status_code=429,
                detail="Groq rate limit reached. Try again later.",
            ) from exc

        raise HTTPException(
            status_code=status,
            detail=f"Groq API failed with HTTP {status}",
        ) from exc

    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=503,
            detail="Could not connect to Groq",
        ) from exc

    except (ValueError, TypeError, AttributeError, KeyError) as exc:
        raise HTTPException(
            status_code=502,
            detail="Groq returned an invalid response",
        ) from exc



# ---------------------------------------
# Multi-agent collaboration endpoint
# ---------------------------------------

#@app.post("/ai/collaborate/legacy")
async def collaborate(request: AIRequest):
    api_key = os.getenv("OPENROUTER_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OpenRouter API key is not configured",
        )

    async with httpx.AsyncClient(timeout=120) as client:

        # Round 1: Nemotron generates the initial solution.
        initial_answer = await call_ai_model(
            client=client,
            model=MODEL_1,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a solution architect. "
                        "Provide a clear, accurate and concise answer. "
                        "Follow the user's requested length. "
                        "Avoid unnecessary explanations and repetition."
                    ),
                },
                {
                    "role": "user",
                    "content": request.task,
                },
            ],
            api_key=api_key,
        )

        # Round 2: Ling reviews Nemotron's answer.
        review = await call_ai_model(
            client=client,
            model=MODEL_2,
            messages=[
                {
                    "role": "system",
                   "content": (
                        "You are a critical reviewer in a multi-agent AI system. "
                        "Review the initial answer for factual mistakes, "
                        "missing information, and weak assumptions. "
                        "Provide at most three specific improvements. "
                        "Keep your review under 150 words. "
                        "Do not rewrite the entire answer. "
                        "Do not agree automatically."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Original task:\n{request.task}\n\n"
                        f"Initial answer:\n{initial_answer}\n\n"
                        "Review the initial answer and suggest "
                        "specific improvements."
                    ),
                },
            ],
            api_key=api_key,
        )

        # Round 3: Nemotron produces the final answer.
        final_answer = await call_ai_model(
            client=client,
            model=MODEL_1,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are the final synthesis agent. "
                        "Produce a complete and accurate answer. "
                        "Use the review to improve the initial solution. "
                        "Evaluate the feedback critically and do not "
                        "accept incorrect suggestions."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Original task:\n{request.task}\n\n"
                        f"Initial answer:\n{initial_answer}\n\n"
                        f"Reviewer feedback:\n{review}\n\n"
                        "Produce the final improved answer."
                    ),
                },
            ],
            api_key=api_key,
        )

    return {
        "status": "completed",
        "discussion": [
            {
                "round": 1,
                "model": MODEL_1,
                "role": "initial_solution",
                "content": initial_answer,
            },
            {
                "round": 2,
                "model": MODEL_2,
                "role": "reviewer",
                "content": review,
            },
            {
                "round": 3,
                "model": MODEL_1,
                "role": "final_synthesis",
                "content": final_answer,
            },
        ],
        "final_answer": final_answer,
    }


# ---------------------------------------
# Real-time collaboration progress
# ---------------------------------------

#@app.post("/ai/collaborate/stream")
async def collaborate_stream(request: AIRequest):
    if not any(os.getenv(k) for k in (
        "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"
    )):
        raise HTTPException(status_code=503, detail="No AI providers configured")

    def event(event_type, data):
        return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"

    async def generate():
        async with httpx.AsyncClient(timeout=120) as client:
            current_round = 1
            try:
                yield event("progress", {"round": 1, "status": "processing"})
                first = await call_ai_with_fallback(
                    client=client,
                    messages=[
                        {"role": "system", "content": (
                            "You are an AI assistant. Answer the user's task directly "
                            "and accurately. Avoid repetition and follow the requested length."
                        )},
                        {"role": "user", "content": request.task},
                    ],
                    max_tokens=1200,
                )
                initial_answer = first["answer"]
                yield event("progress", {
    "round": 1,
    "status": "completed",
    "provider": first["provider"],
    "model": first["model"],
    "fallback_used": first["fallback_used"],
})

                current_round = 2
                yield event("progress", {"round": 2, "status": "processing"})
                second = await call_ai_with_fallback(
                    client=client,
                    messages=[
                        {"role": "system", "content": (
                            "You are a critical reviewer. Identify factual errors, "
                            "missing details and weak assumptions. Give at most three "
                            "specific improvements in under 150 words. Do not rewrite the answer."
                        )},
                        {"role": "user", "content": (
                            f"Original task:\n{request.task}\n\n"
                            f"Initial answer:\n{initial_answer}\n\n"
                            "Review the answer and suggest improvements."
                        )},
                    ],
                    max_tokens=1200,
                    provider_order=("openrouter", "groq", "gemini"),
                )
                review = second["answer"]
                yield event("progress", {
                    "round": 2,
                    "status": "completed",
                    "provider": second["provider"],
                    "model": second["model"],
                    "fallback_used": second["fallback_used"],
                })

                current_round = 3
                yield event("progress", {"round": 3, "status": "processing"})
                third = await call_ai_with_fallback(
                    client=client,
                    messages=[
                        {"role": "system", "content": (
                            "You are the final synthesis agent. Improve the initial "
                            "answer using valid reviewer feedback. Follow the user's "
                            "requested length. Produce a complete, accurate answer."
                        )},
                        {"role": "user", "content": (
                            f"Original task:\n{request.task}\n\n"
                            f"Initial answer:\n{initial_answer}\n\n"
                            f"Reviewer feedback:\n{review}\n\n"
                            "Produce the final improved answer."
                        )},
                    ],
                    max_tokens=1200,
                )

                yield event("progress", {
                    "round": 3,
                    "status": "completed",
                    "provider": third["provider"],
                    "model": third["model"],
                    "fallback_used": third["fallback_used"],
            })

                yield event("result", {
                    "status": "completed", "final_answer": third["answer"],
                })
            except HTTPException as exc:
                yield event("failure", {
                    "round": current_round, "status": "failed",
                    "message": str(exc.detail),
                })
            except Exception:
                yield event("failure", {
                    "round": current_round, "status": "failed",
                    "message": "An unexpected collaboration error occurred.",
                })

    return StreamingResponse(
        generate(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ---------------------------------------
# Groq API test endpoint
# ---------------------------------------

#@app.post("/ai/groq-test")
async def test_groq(request: AIRequest):
    api_key = os.getenv("GROQ_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="Groq API key is not configured",
        )

    async with httpx.AsyncClient(timeout=120) as client:
        answer = await call_groq_model(
            client=client,
            messages=[
                {
                    "role": "user",
                    "content": request.task,
                }
            ],
            api_key=api_key,
            max_tokens=500,
        )

    return {
        "status": "completed",
        "model": GROQ_MODEL,
        "answer": answer,
    }

# ---------------------------------------
# Gemini API test endpoint
# ---------------------------------------

#@app.post("/ai/gemini-test")
async def test_gemini(request: AIRequest):
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="Gemini API key is not configured",
        )

    async with httpx.AsyncClient(timeout=120) as client:
        answer = await call_gemini_model(
            client=client,
            messages=[
                {
                    "role": "user",
                    "content": request.task,
                }
            ],
            api_key=api_key,
            max_tokens=500,
        )

    return {
        "status": "completed",
        "model": GEMINI_MODEL,
        "answer": answer,
    }


# ---------------------------------------
# Provider fallback (independent test endpoint)
# ---------------------------------------

import asyncio

OLLAMA_INFERENCE_SEMAPHORE = asyncio.Semaphore(1)


async def call_ai_with_fallback(
    client: httpx.AsyncClient,
    messages: list[dict[str, str]],
    max_tokens: int = 800,
    provider_order: tuple[str, ...] = (
        "groq", "gemini", "openrouter"
    ),
    personal_keys: dict[str, str] | None = None,
) -> dict:
    """Try configured approved providers; never use paid fallback."""
    provider_map = {
        "groq": (GROQ_MODEL, "GROQ_API_KEY"),
        "gemini": (GEMINI_MODEL, "GEMINI_API_KEY"),
        "openrouter": (MODEL_2, "OPENROUTER_API_KEY"),
        "ollama": ("qwen2.5:1.5b", ""),
    }

    if (
    not provider_order
    or len(set(provider_order)) != len(provider_order)
    or any(provider not in provider_map for provider in provider_order)
):
        raise ValueError("Invalid provider selection")


    providers = [
        (name, *provider_map[name])
        for name in provider_order
    ]

        # Validate every selected model before any API call.
    for provider, model, env_name in providers:
        validate_model(provider, model)

    attempted = []

    for provider, model, env_name in providers:
        if provider == "ollama":
            api_key = (
                "local" if os.getenv("ENABLE_LOCAL_OLLAMA", "false").lower() == "true" else None
            )
        elif personal_keys is not None:
            api_key = personal_keys.get(provider)
        else:
            api_key = os.getenv(env_name)

        if not api_key:
            attempted.append({
                "provider": provider,
                "status": "not_configured",
            })
            continue

        try:
            if provider == "ollama":
                if OLLAMA_INFERENCE_SEMAPHORE.locked():
                    attempted.append({
                        "provider": provider,
                        "status": "unavailable",
                    })
                    continue

                async with OLLAMA_INFERENCE_SEMAPHORE:
                    response = await client.post(
                        "http://127.0.0.1:11434/api/chat",
                    json={
                        "model": model,
                        "messages": messages,
                        "stream": False,
                        "options": {"num_predict": min(max_tokens, 800)},
                    },
                    timeout=httpx.Timeout(
                        connect=5.0,
                        read=120.0,
                        write=10.0,
                        pool=5.0,
                    ),
                )
                response.raise_for_status()
                try:
                    answer = response.json()["message"]["content"]
                    if not isinstance(answer, str) or not answer.strip():
                        raise ValueError("Ollama returned an empty answer")
                except (ValueError, KeyError, TypeError) as exc:
                    attempted.append({
                        "provider": provider,
                        "status": "unavailable",
                    })
                    continue
            elif provider == "groq":
                answer = await call_groq_model(
                    client, messages, api_key,
                    max_tokens=max_tokens,
                )
            elif provider == "gemini":
                answer = await call_gemini_model(
                    client, messages, api_key,
                    max_tokens=max_tokens,
                )
            else:
                answer = await call_ai_model(
                    client, model, messages, api_key,
                    max_tokens=max_tokens,
                )

            return {
                "status": "completed",
                "provider": provider,
                "model": model,
                "answer": answer,
                "fallback_used": len(attempted) > 0,
            }


        except HTTPException as exc:
            print(
                f"[AI PROVIDER FAILED] "
                f"Provider={provider} | "
                f"Model={model} | "
                f"HTTP={exc.status_code} | "
                f"Reason={exc.detail}",
                flush=True,
            )

            if not is_retryable_provider_error(exc):
                raise

            attempted.append({
                "provider": provider,
                "status": "retryable_error",
                "http_status": exc.status_code,
            })

        except httpx.HTTPStatusError as exc:
            if provider != "ollama" or exc.response.status_code not in (
                429, 500, 502, 503, 504
            ):
                raise

            attempted.append({
                "provider": provider,
                "status": "retryable_error",
                "http_status": exc.response.status_code,
            })

        except (httpx.TimeoutException, httpx.TransportError):
            attempted.append({
                "provider": provider,
                "status": "unavailable",
            })

    if any(
        item["status"] in ("retryable_error", "unavailable")
        for item in attempted
    ):
        raise ProviderCapacityError()

    raise HTTPException(
        status_code=503,
        detail="No eligible AI providers are configured.",
    )

#@app.post("/ai/fallback-test")
async def fallback_test(request: AIRequest):
    async with httpx.AsyncClient(timeout=60) as client:
        return await call_ai_with_fallback(
            client=client,
            messages=[{"role": "user", "content": request.task}],
            max_tokens=800,
        )

# ---------------------------------------
# Multi-Agent Task Coordinator
# ---------------------------------------

from app.task_coordinator import create_task_plan


#@app.post("/ai/task-plan")
async def generate_task_plan(request: AIRequest):
    async with httpx.AsyncClient(timeout=120) as client:

        async def ai_caller(messages):
            return await call_ai_with_fallback(
                client=client,
                messages=messages,
                max_tokens=1500,
            )

        try:
            plan = await create_task_plan(
                task=request.task,
                ai_caller=ai_caller,
            )

            return {
                "status": "completed",
                "plan": plan.model_dump(),
            }

        except ValueError as exc:
            raise HTTPException(
                status_code=502,
                detail=str(exc),
            ) from exc


# ---------------------------------------
# Multi-Agent Task Execution
# ---------------------------------------

from app.agent_executor import execute_task_plan
from app.ai_agent_runner import create_ai_agent_runner


#@app.post("/ai/execute-plan")
async def execute_ai_plan(request: AIRequest):
    async with httpx.AsyncClient(timeout=120) as client:


        async def ai_caller(
    messages,
    provider_order=("groq", "gemini", "openrouter"),
):
         return await call_ai_with_fallback(
        client=client,
        messages=messages,
        max_tokens=1500,
        provider_order=provider_order,
    )


        # Step 1: Coordinator creates the task plan.
        plan = await create_task_plan(
            task=request.task,
            ai_caller=ai_caller,
        )

        # Step 2: Create specialized AI agents.
        runner = create_ai_agent_runner(ai_caller)

        # Step 3: Execute tasks in dependency order.
        execution = await execute_task_plan(
            plan=plan,
            agent_runner=runner,
        )


        return {
    "status": execution["status"],
    "review_status": execution["review_status"],
    "plan": plan.model_dump(),
    "results": execution["results"],
    "model_usage": execution["model_usage"],
    "execution_log": execution["execution_log"],
}


# ---------------------------------------
# Dynamic Multi-Model Collaboration
# ---------------------------------------

from app.collaboration import (
    execute_collaboration,
    synthesize_collaboration,
)

@app.post("/ai/collaborate")
async def collaborate_ai_models(
    request: AIRequest,
    user: dict = Depends(verify_user),
):
    if request.use_personal_keys and not request.accept_provider_charges:
        raise HTTPException(
            status_code=400,
            detail="You must accept potential provider charges before using personal API keys.",
        )

    personal_keys = None

    if request.use_personal_keys:
        personal_keys = {}

        try:
            for provider in ("gemini", "groq", "openrouter"):
                key = await get_user_provider_key(
                    user_id=user["sub"],
                    provider=provider,
                )

                if key:
                    personal_keys[provider] = key

        except (httpx.HTTPError, RuntimeError) as exc:
            raise HTTPException(
                status_code=503,
                detail="Unable to retrieve personal API keys",
            ) from exc

        if len(personal_keys) < 2:
            raise HTTPException(
                status_code=400,
                detail="Add at least two personal provider API keys in API Settings to start a multi-model collaboration.",
            )

    if personal_keys is not None:
        selected_models = [
            provider
            for provider in ("gemini", "groq", "openrouter")
            if provider in personal_keys
        ]
    else:
        selected_models = ["gemini", "groq"]

    if request.selected_models is not None:
        requested = request.selected_models

        if (
            not 2 <= len(requested) <= 4
            or len(set(requested)) != len(requested)
            or any(
                provider not in ("gemini", "groq", "openrouter", "ollama")
                for provider in requested
            )
        ):
            raise HTTPException(
                status_code=400,
                detail="Select 2-4 distinct approved AI providers.",
            )

        if "ollama" in requested and os.getenv("ENABLE_LOCAL_OLLAMA", "false").lower() != "true":
            raise HTTPException(
                status_code=400,
                detail="Local Ollama is disabled.",
            )

        if request.use_personal_keys:
            missing = [
                provider for provider in requested
                if provider != "ollama" and provider not in personal_keys
            ]
            if missing:
                raise HTTPException(
                    status_code=400,
                    detail="Missing personal API keys for selected providers.",
                )

        if not request.use_personal_keys:
            allowed_platform_models = {"gemini", "groq"}

            if os.getenv("ENABLE_LOCAL_OLLAMA", "false").lower() == "true":
                allowed_platform_models.add("ollama")

            if any(
                provider not in allowed_platform_models
                for provider in requested
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Selected provider is unavailable in platform mode.",
                )

        selected_models = requested

    max_rounds = 2

    try:
        reservation = await create_collaboration_with_quota(
            user_id=user["sub"],
            task=request.task,
            selected_models=selected_models,
            max_rounds=max_rounds,
            credential_mode=(
                "personal" if request.use_personal_keys
                else "platform"
            ),
            daily_limit=10,
        )
    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to reserve quota and create collaboration task",
        ) from exc

    if not reservation["allowed"]:
        raise HTTPException(
            status_code=429,
            detail="Daily AI request limit reached. Try again tomorrow (UTC).",
        )

    task_id = UUID(str(reservation["task_id"]))

    async with httpx.AsyncClient(timeout=120) as client:

        async def ai_caller(messages, provider_order):
            return await call_ai_with_fallback(
                client=client,
                messages=messages,
                max_tokens=2000,
                provider_order=provider_order,
                personal_keys=personal_keys,
            )

        result = await run_claimed_collaboration(
            task_id=task_id,
            task=request.task,
            model_ids=selected_models,
            ai_caller=ai_caller,
            max_rounds=max_rounds,
        )

        result["task_id"] = str(task_id)
        result["requests_remaining"] = reservation["requests_remaining"]

        return result

def get_retry_status(task: dict) -> str:
    """Determine automatic retry availability."""

    if task.get("status") != "paused":
        return "not_required"

    if task.get("credential_mode") != "platform":
        return "not_eligible"

    if not task.get("auto_resume_enabled"):
        return "not_eligible"

    if not task.get("next_retry_at"):
        if task.get("retry_count", 0) >= 24:
            return "retry_limit_reached"

        return "not_scheduled"

    if os.getenv("ENABLE_AUTO_RESUME", "false").strip().lower() != "true":
        return "worker_disabled"

    return "waiting_for_capacity"

@app.get("/ai/history")
async def get_collaboration_history(
    user: dict = Depends(verify_user),
):
    try:
        tasks = await get_user_collaboration_tasks(
            user_id=user["sub"],
            limit=50,
        )

        for task in tasks:
            task["retry_status"] = get_retry_status(task)

        return {"tasks": tasks}

    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve collaboration history",
        ) from exc


@app.get("/ai/history/{task_id}")
async def get_collaboration_details(
    task_id: UUID,
    user: dict = Depends(verify_user),
):
    try:
        task = await get_user_collaboration_task(
            user_id=user["sub"],
            task_id=str(task_id),
        )

        if task is None:
            raise HTTPException(
                status_code=404,
                detail="Collaboration task not found",
            )

        turns = await get_collaboration_turns(
            task_id=str(task_id),
        )

        task["retry_status"] = get_retry_status(task)

        return {
            "task": task,
            "turns": turns,
        }

    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve collaboration details",
        ) from exc

@app.get("/ai/usage")
async def get_ai_usage(
    user: dict = Depends(verify_user),
):
    try:
        return await get_user_ai_usage(
            user_id=user["sub"],
            daily_limit=10,
        )

    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve daily AI usage",
        ) from exc


@app.get("/ai/api-keys")
async def list_personal_api_keys(
    user: dict = Depends(verify_user),
):
    try:
        keys = await get_user_api_keys(
            user_id=user["sub"]
        )

        return {
            "keys": keys,
            "supported_providers": [
                "gemini",
                "groq",
                "openrouter",
            ],
        }

    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve API key settings",
        ) from exc


from pydantic import BaseModel, SecretStr, Field

class PersonalAPIKeyRequest(BaseModel):
    provider: Literal["gemini", "groq", "openrouter"]
    api_key: SecretStr = Field(
        min_length=1,
        max_length=2048,
    )


@app.post("/ai/api-keys")
async def save_personal_api_key(
    request: PersonalAPIKeyRequest,
    user: dict = Depends(verify_user),
):
    api_key = request.api_key.get_secret_value().strip()

    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="API key cannot be empty",
        )

    try:
        return await save_user_api_key(
            user_id=user["sub"],
            provider=request.provider,
            api_key=api_key,
        )

    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to save API key",
        ) from exc


@app.delete("/ai/api-keys/{provider}")
async def remove_personal_api_key(
    provider: Literal["gemini", "groq", "openrouter"],
    user: dict = Depends(verify_user),
):
    try:
        return await delete_user_api_key(
            user_id=user["sub"],
            provider=provider,
        )

    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to remove API key",
        ) from exc

async def resume_saved_collaboration(saved_task: dict) -> dict:
    """Resume an eligible platform collaboration."""

    selected_models = saved_task["selected_models"]


    task_id = UUID(str(saved_task["id"]))

    async with httpx.AsyncClient(timeout=120) as client:

        async def ai_caller(messages, provider_order):
            return await call_ai_with_fallback(
                client=client,
                messages=messages,
                max_tokens=2000,
                provider_order=provider_order,
                personal_keys=None,
            )

        return await run_claimed_collaboration(
            task_id=task_id,
            task=saved_task["task"],
            model_ids=saved_task["selected_models"],
            ai_caller=ai_caller,
            max_rounds=saved_task["max_rounds"],
        )


@app.post("/student/ai/documents/{document_id}/summarize")
async def summarize_student_document(
    document_id: UUID,
    request: StudentAIRequest,
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))

    # Require consent before external AI processing
    if not request.accept_document_processing:
        raise HTTPException(
            status_code=400,
            detail=(
                "You must accept external AI document "
                "processing before generating a summary."
            ),
        )

    if (
        request.use_personal_keys
        and not request.accept_provider_charges
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "You must accept potential provider charges "
                "before using personal API keys."
            ),
        )

    personal_keys = None

    try:
        if request.use_personal_keys:
            personal_keys = {}

            for provider in (
                "gemini",
                "groq",
                "openrouter",
            ):
                key = await get_user_provider_key(
                    user_id=user_id,
                    provider=provider,
                )

                if key:
                    personal_keys[provider] = key

            if not personal_keys:
                raise HTTPException(
                    status_code=400,
                    detail="Configure at least one personal API key.",
                )

        else:
            if not any(
                os.getenv(name)
                for name in (
                    "GEMINI_API_KEY",
                    "GROQ_API_KEY",
                    "OPENROUTER_API_KEY",
                )
            ):
                raise HTTPException(
                    status_code=503,
                    detail="No AI providers are currently configured.",
                )

        # Verify ownership and extract document content
        document = await extract_uploaded_document(
            document_id=document_id,
            user=user,
        )

        text = document["text"]
        title = document["title"]

        chunks = chunk_document(text)

        if not chunks:
            raise HTTPException(
                status_code=422,
                detail="No readable document content found.",
            )

        if len(chunks) > MAX_SUMMARY_CHUNKS:
            raise HTTPException(
                status_code=413,
                detail=(
                    "Document exceeds the AI processing limit. "
                    "Please split it into smaller documents."
                ),
            )

        # Reserve section summaries plus final synthesis.
        required_calls = len(chunks) + 1
        request_id = str(uuid4())

        quota = await reserve_student_ai_request(
            user_id=user_id,
            request_id=request_id,
            requested_calls=required_calls,
        )

        if not quota["allowed"]:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"This summary requires {required_calls} "
                    "AI calls, but only "
                    f"{quota['calls_remaining']} remain today."
                ),
            )

        reservation_id = quota["reservation_id"]
        successful_ai_calls = 0
        result = None

        try:
            async with httpx.AsyncClient(timeout=60) as client:

                async def ai_caller(messages, max_tokens):
                    nonlocal successful_ai_calls

                    response = await call_ai_with_fallback(
                        client=client,
                        messages=messages,
                        max_tokens=max_tokens,
                        provider_order=(
                            "groq",
                            "gemini",
                            "openrouter",
                        ),
                        personal_keys=personal_keys,
                    )

                    if (
                        isinstance(response, dict)
                        and isinstance(response.get("answer"), str)
                        and response["answer"].strip()
                    ):
                        successful_ai_calls += 1

                    return response

                result = await summarize_document(
                    text=text,
                    title=title,
                    ai_caller=ai_caller,
                    generation_type=request.generation_type,
                )
        except BaseException:
            try:
                await settle_student_ai_request(
                    reservation_id=reservation_id,
                    calls_charged=0,
                )
            except Exception:
                import logging
                logging.getLogger(__name__).exception(
                    "Student AI quota settlement failed for reservation %s",
                    reservation_id,
                )
            raise
        else:
            settlement = await settle_student_ai_request(
                reservation_id=reservation_id,
                calls_charged=successful_ai_calls,
            )

        return {
            **result,
            "document_id": str(document_id),
            "calls_remaining": settlement["calls_remaining"],
            "daily_limit": quota["daily_limit"],
        }

    except StudentAIError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    except HTTPException:
        raise

    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Student AI processing is temporarily unavailable.",
        ) from exc


@app.get("/student/ai/usage")
async def student_ai_usage(
    user: dict = Depends(verify_user),
):
    try:
        return await get_student_ai_usage(
            user_id=str(UUID(user["sub"])),
        )

    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve Student AI usage.",
        ) from exc



# ============================================================
# STUDENT AI TUTOR ENDPOINTS
# ============================================================

from app.student_tutor import (
    generate_tutor_response,
    StudentTutorError,
    MAX_HISTORY_MESSAGES,
)

from app.database import (
    create_supabase_client,
    create_student_ai_chat,
    get_student_ai_chats,
    get_student_ai_chat,
    get_student_ai_messages,
    save_student_ai_exchange,
    update_student_ai_chat,
    delete_student_ai_chat,
)


class StudentTutorChatRequest(BaseModel):
    title: str = Field(
        default="New conversation",
        max_length=250,
    )
    subject_id: UUID | None = None


class StudentTutorMessageRequest(BaseModel):
    question: str = Field(
        min_length=1,
        max_length=5000,
    )
    document_id: UUID | None = None
    use_personal_keys: bool = False
    accept_provider_charges: bool = False
    accept_ai_processing: bool = False


async def get_tutor_subject(
    user_id: str,
    subject_id: str,
) -> dict:
    """Retrieve a subject belonging to the current user."""

    async with create_supabase_client() as client:
        response = await client.get(
            "student_subjects",
            params={
                "id": f"eq.{subject_id}",
                "user_id": f"eq.{user_id}",
                "select": "id,name",
                "limit": 1,
            },
        )

        response.raise_for_status()
        records = response.json()

        if not records:
            raise HTTPException(
                status_code=404,
                detail="Subject not found.",
            )

        return records[0]


@app.get("/student/ai/chats")
async def list_tutor_chats(
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))

    try:
        chats = await get_student_ai_chats(
            user_id=user_id,
        )

        return {"chats": chats}

    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve conversations.",
        ) from exc


@app.post("/student/ai/chats", status_code=201)
async def create_tutor_chat(
    request: StudentTutorChatRequest,
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))

    subject_id = (
        str(request.subject_id)
        if request.subject_id else None
    )

    try:
        if subject_id:
            await get_tutor_subject(
                user_id=user_id,
                subject_id=subject_id,
            )

        chat = await create_student_ai_chat(
            user_id=user_id,
            title=request.title,
            subject_id=subject_id,
        )

        return {"chat": chat}

    except HTTPException:
        raise

    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to create conversation.",
        ) from exc


@app.get("/student/ai/chats/{chat_id}")
async def retrieve_tutor_chat(
    chat_id: UUID,
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))
    chat_id = str(chat_id)

    try:
        chat = await get_student_ai_chat(
            user_id=user_id,
            chat_id=chat_id,
        )

        if not chat:
            raise HTTPException(
                status_code=404,
                detail="Conversation not found.",
            )

        messages = await get_student_ai_messages(
            user_id=user_id,
            chat_id=chat_id,
        )

        return {
            "chat": chat,
            "messages": messages,
        }

    except HTTPException:
        raise

    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to load conversation.",
        ) from exc


@app.delete("/student/ai/chats/{chat_id}")
async def remove_tutor_chat(
    chat_id: UUID,
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))

    try:
        deleted = await delete_student_ai_chat(
            user_id=user_id,
            chat_id=str(chat_id),
        )

        if not deleted:
            raise HTTPException(
                status_code=404,
                detail="Conversation not found.",
            )

        return {
            "status": "deleted",
            "message": "Conversation deleted.",
        }

    except HTTPException:
        raise

    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to delete conversation.",
        ) from exc


@app.post("/student/ai/chats/{chat_id}/messages")
async def send_tutor_message(
    chat_id: UUID,
    request: StudentTutorMessageRequest,
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))
    chat_id = str(chat_id)
    question = request.question.strip()

    if not question:
        raise HTTPException(
            status_code=400,
            detail="Please enter a question.",
        )

    if not request.accept_ai_processing:
        raise HTTPException(
            status_code=400,
            detail=(
                "Accept external AI processing of your "
                "question, conversation history and any "
                "selected document before continuing."
            ),
        )

    if (
        request.use_personal_keys
        and not request.accept_provider_charges
    ):
        raise HTTPException(
            status_code=400,
            detail="Accept potential provider charges.",
        )

    try:
        # Verify conversation ownership.

        chat = await get_student_ai_chat(
            user_id=user_id,
            chat_id=chat_id,
        )

        if not chat:
            raise HTTPException(
                status_code=404,
                detail="Conversation not found.",
            )

        # Resolve the optional academic subject.

        subject_name = None

        if chat.get("subject_id"):
            subject = await get_tutor_subject(
                user_id=user_id,
                subject_id=str(chat["subject_id"]),
            )

            subject_name = subject["name"]

        # Determine which provider credentials to use.

        personal_keys = None

        if request.use_personal_keys:
            personal_keys = {}

            for provider in (
                "groq",
                "gemini",
                "openrouter",
            ):
                key = await get_user_provider_key(
                    user_id=user_id,
                    provider=provider,
                )

                if key:
                    personal_keys[provider] = key

            if not personal_keys:
                raise HTTPException(
                    status_code=400,
                    detail="Configure a personal API key.",
                )

        else:
            if not any(
                os.getenv(name)
                for name in (
                    "GROQ_API_KEY",
                    "GEMINI_API_KEY",
                    "OPENROUTER_API_KEY",
                )
            ):
                raise HTTPException(
                    status_code=503,
                    detail="No AI providers configured.",
                )

        # Retrieve recent conversation history.

        history = await get_student_ai_messages(
            user_id=user_id,
            chat_id=chat_id,
            limit=MAX_HISTORY_MESSAGES,
        )

        # Extract optional owned document.

        document_text = None
        document_title = None

        if request.document_id:
            document = await extract_uploaded_document(
                document_id=request.document_id,
                user=user,
            )

            document_text = document["text"]
            document_title = document["title"]

        # Reserve one logical Student AI call.

        quota = await reserve_student_ai_request(
            user_id=user_id,
            request_id=str(uuid4()),
            requested_calls=1,
        )

        if not quota["allowed"]:
            raise HTTPException(
                status_code=429,
                detail=(
                    "Daily Student AI allowance exhausted. "
                    "Please try again after the quota resets."
                ),
            )

        # Generate response using provider fallback.

        reservation_id = quota["reservation_id"]
        try:
            async with httpx.AsyncClient(
                timeout=60.0,
            ) as client:

                async def ai_caller(
                    messages,
                    max_tokens,
                ):
                    return await call_ai_with_fallback(
                        client=client,
                        messages=messages,
                        max_tokens=max_tokens,
                        provider_order=(
                            "groq",
                            "gemini",
                            "openrouter",
                        ),
                        personal_keys=personal_keys,
                    )

                result = await generate_tutor_response(
                    question=question,
                    history=history,
                    ai_caller=ai_caller,
                    subject_name=subject_name,
                    document_text=document_text,
                    document_title=document_title,
                )
        except BaseException:
            try:
                await settle_student_ai_request(
                    reservation_id=reservation_id,
                    calls_charged=0,
                )
            except Exception:
                import logging
                logging.getLogger(__name__).exception(
                    "AI Tutor quota refund failed"
                )
            raise

        settlement = await settle_student_ai_request(
            reservation_id=reservation_id,
            calls_charged=1,
        )

        # Persist question and answer together.

        saved_messages = await save_student_ai_exchange(
            user_id=user_id,
            chat_id=chat_id,
            question=question,
            answer=result["answer"],
            provider=result.get("provider"),
            model_id=result.get("model"),
        )

        # Automatically name the first conversation.

        new_title = None

        if (
            not history
            and chat.get("title") == "New conversation"
        ):
            new_title = question[:80]

        try:
            updated_chat = await update_student_ai_chat(
                user_id=user_id,
                chat_id=chat_id,
                title=new_title,
            )

        except (httpx.HTTPError, RuntimeError):
            # The exchange is saved even if updating the
            # conversation title or timestamp fails.
            updated_chat = None

        return {
            **result,
            "chat_id": chat_id,
            "chat": updated_chat or chat,
            "messages": saved_messages,
            "calls_remaining": settlement["calls_remaining"],
            "daily_limit": quota["daily_limit"],
        }

    except StudentTutorError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    except HTTPException:
        raise

    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "AI Tutor is temporarily unavailable. "
                "Please check your conversation before retrying."
            ),
        ) from exc



# ---------------------------------------
# AI Student Progress Tracker
# ---------------------------------------

from datetime import date as ProgressDate

from app.student_progress import (
    collect_student_progress,
    generate_progress_analysis,
    StudentProgressError,
)


class StudentProgressRequest(BaseModel):
    attendance_target: int = Field(
        default=75, ge=50, le=95
    )
    local_date: ProgressDate | None = None
    accept_ai_processing: bool = False
    use_personal_keys: bool = False
    accept_provider_charges: bool = False


@app.get("/student/ai/progress")
async def student_progress_overview(
    attendance_target: int = 75,
    local_date: ProgressDate | None = None,
    user: dict = Depends(verify_user),
):
    if not 50 <= attendance_target <= 95:
        raise HTTPException(
            status_code=400,
            detail="Invalid attendance target.",
        )

    try:
        return await collect_student_progress(
            user_id=str(UUID(user["sub"])),
            attendance_target=attendance_target,
            local_date=local_date,
        )

    except StudentProgressError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    except (httpx.HTTPError, RuntimeError, ValueError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve academic progress.",
        ) from exc


@app.post("/student/ai/progress/analyze")
async def analyze_student_progress(
    request: StudentProgressRequest,
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))

    if not request.accept_ai_processing:
        raise HTTPException(
            status_code=400,
            detail=(
                "Accept external AI processing of "
                "academic statistics before continuing."
            ),
        )

    if (
        request.use_personal_keys
        and not request.accept_provider_charges
    ):
        raise HTTPException(
            status_code=400,
            detail="Accept potential provider charges first.",
        )

    try:
        personal_keys = None

        if request.use_personal_keys:
            personal_keys = {}

            for provider in (
                "groq", "gemini", "openrouter"
            ):
                key = await get_user_provider_key(
                    user_id=user_id,
                    provider=provider,
                )

                if key:
                    personal_keys[provider] = key

            if not personal_keys:
                raise HTTPException(
                    status_code=400,
                    detail="Configure a personal API key first.",
                )

        elif not any(
            os.getenv(name, "").strip()
            for name in (
                "GROQ_API_KEY",
                "GEMINI_API_KEY",
                "OPENROUTER_API_KEY",
            )
        ):
            raise HTTPException(
                status_code=503,
                detail="No AI provider is configured.",
            )

        progress = await collect_student_progress(
            user_id=user_id,
            attendance_target=request.attendance_target,
            local_date=request.local_date,
        )

        if not progress.get("has_activity"):
            raise HTTPException(
                status_code=422,
                detail=(
                    "Add academic records before "
                    "requesting AI analysis."
                ),
            )

        if len(json.dumps(
            progress,
            ensure_ascii=False,
            default=str,
        )) > 50000:
            raise HTTPException(
                status_code=422,
                detail="Academic analysis context exceeds the limit.",
            )

        quota = await reserve_student_ai_request(
            user_id=user_id,
            request_id=str(uuid4()),
            requested_calls=1,
        )

        if not quota["allowed"]:
            raise HTTPException(
                status_code=429,
                detail="Daily Student AI allowance exhausted.",
            )

        reservation_id = quota["reservation_id"]
        try:
            async with httpx.AsyncClient(timeout=60) as client:

                async def ai_caller(messages, max_tokens):
                    return await call_ai_with_fallback(
                        client=client,
                        messages=messages,
                        max_tokens=max_tokens,
                        provider_order=(
                            "groq", "gemini", "openrouter"
                        ),
                        personal_keys=personal_keys,
                    )

                result = await generate_progress_analysis(
                    progress=progress,
                    ai_caller=ai_caller,
                )
        except BaseException:
            try:
                await settle_student_ai_request(
                    reservation_id=reservation_id,
                    calls_charged=0,
                )
            except Exception:
                import logging
                logging.getLogger(__name__).exception(
                    "Progress Tracker quota refund failed"
                )
            raise

        settlement = await settle_student_ai_request(
            reservation_id=reservation_id,
            calls_charged=1,
        )

        return {
            **result,
            "progress": progress,
            "calls_remaining": settlement["calls_remaining"],
            "daily_limit": quota["daily_limit"],
        }

    except StudentProgressError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    except HTTPException:
        raise

    except (httpx.HTTPError, RuntimeError, ValueError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Academic progress analysis is unavailable.",
        ) from exc

# === Step 633D.5E.3: Student mock-test endpoints ===

from app.database import (
    get_student_mock_exam,
    create_student_mock_test,
    get_student_mock_test,
    save_student_mock_attempt,
)
from app.student_mock_tests import (
    MockTestError,
    generate_mock_questions,
    public_questions,
    grade_mock_test,
)


class MockTestGenerateRequest(BaseModel):
    exam_id: UUID
    topic: str = Field(min_length=1, max_length=250)
    question_count: int = Field(default=5, ge=3, le=10)
    use_personal_keys: bool = False
    accept_provider_charges: bool = False
    accept_ai_processing: bool = False


class MockTestSubmitRequest(BaseModel):
    submitted_answers: dict[str, str]


@app.post("/student/ai/mock-tests/generate")
async def generate_student_mock_test(
    request: MockTestGenerateRequest,
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))

    if not request.accept_ai_processing:
        raise HTTPException(
            status_code=422,
            detail="AI processing consent is required.",
        )

    if request.use_personal_keys and not request.accept_provider_charges:
        raise HTTPException(
            status_code=422,
            detail="Personal API key charge consent is required.",
        )

    exam = await get_student_mock_exam(user_id, str(request.exam_id))

    if exam is None:
        raise HTTPException(status_code=404, detail="Exam not found.")

    topic = request.topic.strip()

    syllabus_topics = [
        item.strip()
        for item in (exam.get("syllabus") or "").splitlines()
        if item.strip()
    ]

    if topic not in syllabus_topics:
        raise HTTPException(
            status_code=422,
            detail="Topic must match an exam syllabus entry.",
        )

    personal_keys = {}

    if request.use_personal_keys:
        from app.database import get_user_provider_key

        for provider in ("groq", "gemini", "openrouter"):
            key = await get_user_provider_key(user_id, provider)
            if key:
                personal_keys[provider] = key

        if not personal_keys:
            raise HTTPException(
                status_code=422,
                detail="No personal AI provider keys configured.",
            )

    else:
        if not any(
            os.getenv(name, "").strip()
            for name in (
                "GROQ_API_KEY",
                "GEMINI_API_KEY",
                "OPENROUTER_API_KEY",
            )
        ):
            raise HTTPException(
                status_code=503,
                detail="No AI provider is configured.",
            )

    quota = await reserve_student_ai_request(
        user_id=user_id,
        request_id=str(uuid4()),
        requested_calls=1,
    )

    if not quota.get("allowed"):
        raise HTTPException(
            status_code=429,
            detail="Daily student AI quota reached.",
        )

    reservation_id = quota["reservation_id"]

    saved_successfully = False

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:

            async def ai_caller(messages, max_tokens):
                return await call_ai_with_fallback(
                    client=client,
                    messages=messages,
                    max_tokens=max_tokens,
                    provider_order=("groq", "gemini", "openrouter"),
                    personal_keys=personal_keys or None,
                )

            generated = await generate_mock_questions(
                subject=exam.get("title") or "Academic subject",
                topic=topic,
                question_count=request.question_count,
                ai_caller=ai_caller,
            )

        saved = await create_student_mock_test(
            user_id=user_id,
            exam_id=str(request.exam_id),
            subject_id=exam.get("subject_id"),
            topic=topic,
            questions=generated["questions"],
        )

        saved_successfully = True

        settlement = await settle_student_ai_request(
            reservation_id=reservation_id,
            calls_charged=1,
        )

        return {
            "test_id": saved["id"],
            "exam_id": str(request.exam_id),
            "topic": topic,
            "questions": public_questions(generated["questions"]),
            "provider": generated.get("provider"),
            "model": generated.get("model"),
            "quota": {**quota, **settlement},
        }

    except BaseException as exc:
        # Refund only when generation or saving failed.
        # Do not refund after a successful save.
        if not saved_successfully:
            try:
                await settle_student_ai_request(
                    reservation_id=reservation_id,
                    calls_charged=0,
                )
            except Exception:
                import logging
                logging.getLogger(__name__).exception(
                    "Mock Test quota refund failed"
                )

        if isinstance(exc, MockTestError):
            raise HTTPException(
                status_code=422,
                detail=str(exc),
            ) from exc

        if isinstance(exc, (httpx.HTTPError, RuntimeError)):
            raise HTTPException(
                status_code=503,
                detail="Mock-test generation is temporarily unavailable.",
            ) from exc

        raise

    # Previous exception handlers are replaced above.
@app.get("/student/ai/mock-tests/{test_id}")
async def retrieve_student_mock_test(
    test_id: UUID,
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))
    saved = await get_student_mock_test(user_id, str(test_id))

    if saved is None:
        raise HTTPException(status_code=404, detail="Mock test not found.")

    return {
        "test_id": saved["id"],
        "exam_id": saved.get("exam_id"),
        "topic": saved["topic"],
        "questions": public_questions(saved["questions"]),
    }


@app.post("/student/ai/mock-tests/{test_id}/submit")
async def submit_student_mock_test(
    test_id: UUID,
    request: MockTestSubmitRequest,
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))
    saved = await get_student_mock_test(user_id, str(test_id))

    if saved is None:
        raise HTTPException(status_code=404, detail="Mock test not found.")

    try:
        result = grade_mock_test(
            saved["questions"],
            request.submitted_answers,
        )
    except MockTestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    attempt = await save_student_mock_attempt(
        user_id=user_id,
        test_id=str(test_id),
        submitted_answers=request.submitted_answers,
        correct_count=result["correct_count"],
        total_questions=result["total_questions"],
        score_percentage=result["score_percentage"],
        passed=result["passed"],
    )

    # Step 633D.5G.3: Apply mock-test progress
    progress = {
        "updated": False,
        "reason": "passing_score_required",
    }

    if result["passed"]:
        from app.database import create_supabase_client

        async with create_supabase_client() as db_client:
            progress_response = await db_client.post(
                "rpc/apply_mock_test_progress",
                json={
                    "p_attempt_id": attempt["id"],
                    "p_user_id": user_id,
                },
            )
            progress_response.raise_for_status()
            progress = progress_response.json()

    return {
        "attempt_id": attempt["id"],
        "test_id": str(test_id),
        **result,
        "exam_progress": progress,
    }

# === End Step 633D.5E.3 ===


# === Step 635B.7: Aptitude API registration ===
from app.student_aptitude_api import make_aptitude_router

app.include_router(
    make_aptitude_router(
        verify_user=verify_user,
        call_ai_with_fallback=call_ai_with_fallback,
    )
)
# === End Step 635B.7 ===


# LOCAL OLLAMA INTEGRATION - OPTIONAL
@app.post("/ai/ollama/test")
async def test_local_ollama(
    request: AIRequest,
    user: dict = Depends(verify_user),
):

    if os.getenv("ENABLE_LOCAL_OLLAMA", "false").lower() != "true":
        raise HTTPException(
            status_code=503,
            detail="Local Ollama is disabled.",
        )

    prompt = request.task.strip()

    if not prompt:
        raise HTTPException(
            status_code=400,
            detail="A prompt is required.",
        )

    if len(prompt) > 4000:
        raise HTTPException(
            status_code=400,
            detail="Prompt is too long.",
        )

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                "http://127.0.0.1:11434/api/chat",
                json={
                    "model": "qwen2.5:1.5b",
                    "messages": [
                        {
                            "role": "user",
                            "content": prompt,
                        }
                    ],
                    "stream": False,
                    "options": {
                        "num_predict": 300,
                    },
                },
            )
            response.raise_for_status()
            data = response.json()

        return {
            "status": "completed",
            "provider": "ollama",
            "model": "qwen2.5:1.5b",
            "answer": data.get("message", {}).get("content", ""),
        }

    except (httpx.HTTPError, ValueError):
        raise HTTPException(
            status_code=503,
            detail="Local Ollama is unavailable.",
        )
