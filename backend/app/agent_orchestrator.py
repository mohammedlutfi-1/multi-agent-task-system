
from dataclasses import dataclass


@dataclass(frozen=True)
class Agent:
    name: str
    responsibility: str


AGENTS = {
    "coordinator": Agent(
        "Task Coordinator",
        "Divide tasks and coordinate agents."
    ),
    "research": Agent(
        "Research Agent",
        "Gather and organize information."
    ),
    "coding": Agent(
        "Coding Agent",
        "Develop and debug code."
    ),
    "analysis": Agent(
        "Analysis Agent",
        "Analyze data and perform calculations."
    ),
    "document": Agent(
        "Document Agent",
        "Create documents and reports."
    ),
    "reviewer": Agent(
    "Final Reviewer Agent",
    "Review completed tasks for accuracy, completeness, "
    "consistency, and unsupported claims."
    ),
}


def get_available_agents():
    return [
        {
            "id": agent_id,
            "name": agent.name,
            "responsibility": agent.responsibility,
        }
        for agent_id, agent in AGENTS.items()
    ]
