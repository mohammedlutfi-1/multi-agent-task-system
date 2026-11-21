
import json
from pyexpat.errors import messages
from typing import Callable, Awaitable


AGENT_INSTRUCTIONS = {
    "research": (
        "You are a Research Agent. Organize relevant information, "
        "identify evidence gaps, and distinguish verified facts "
        "from assumptions. Do not invent sources."
    ),
    "coding": (
        "You are a Coding Agent. Produce correct, maintainable code "
        "and explain important implementation decisions. "
        "Do not claim code was tested unless it was executed."
    ),
    "analysis": (
        "You are an Analysis Agent. Analyze supplied information, "
        "perform justified calculations, and explain findings. "
        "Do not invent datasets, measurements, or results."
    ),
    "document": (
        "You are a Document Agent. Create clear, structured reports "
        "using the supplied information and previous agent outputs. "
        "Do not invent findings or claim files were created."
    ),
    "reviewer": (
    "You are the Final Reviewer Agent in a Multi-Agent AI System. "
    "Review the outputs produced by previous agents. "
    "Check factual accuracy, logical consistency, completeness, "
    "unsupported claims, and whether the original task was fulfilled. "
    "Identify specific errors and missing information. "
    "Do not automatically approve the work. "
    "Do not claim facts are verified without supporting evidence. "
    "Return a structured review containing: "
    "Verdict (PASS or NEEDS_REVISION), "
    "Issues Found, and Recommended Corrections."
),
}

# Preferred AI provider order for each specialized agent.
# These are preferences, not guaranteed provider assignments.

AGENT_PROVIDER_ORDER = {
    "research": ("gemini", "groq", "openrouter"),
    "coding": ("groq", "gemini", "openrouter"),
    "analysis": ("groq", "gemini", "openrouter"),
    "document": ("openrouter", "groq", "gemini"),
    "reviewer": ("gemini", "groq", "openrouter"),
}


def create_ai_agent_runner(
    ai_caller: Callable[..., Awaitable[dict]],
):
    async def run_agent(
        agent: str,
        description: str,
        dependencies: dict[str, str],
    ) -> str:

        if agent not in AGENT_INSTRUCTIONS:
            raise ValueError(f"Unknown agent: {agent}")

        dependency_context = json.dumps(
            dependencies,
            indent=2,
            ensure_ascii=False,
        )

        messages = [
            {
                "role": "system",
                "content": AGENT_INSTRUCTIONS[agent],
            },
            {
                "role": "user",
                "content": (
                    f"Your assigned task:\n{description}\n\n"
                    f"Previous agent outputs:\n{dependency_context}\n\n"
                    "Complete only your assigned task. "
                    "Use previous outputs when relevant. "
                    "If essential input data is missing, explain "
                    "what is needed rather than fabricating results."
                ),
            },
        ]

        provider_order = AGENT_PROVIDER_ORDER.get(
    agent,
    ("groq", "gemini", "openrouter"),
)

        response = await ai_caller(
    messages,
    provider_order=provider_order,
)

        if response.get("status") != "completed":
            raise ValueError("AI provider did not complete the task")

        answer = response.get("answer")

        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("AI agent returned an empty answer")

        return {
    "answer": answer.strip(),
    "provider": response.get("provider"),
    "model": response.get("model"),
}

    return run_agent
