"""Placement aptitude question generation and grading."""

from app.student_mock_tests import (
    MockTestError,
    parse_questions,
    public_questions,
    grade_mock_test,
)

APTITUDE_TOPICS = {
    "quantitative": (
        "Percentages",
        "Profit and Loss",
        "Time and Work",
        "Time, Speed and Distance",
        "Ratio and Proportion",
        "Averages",
        "Simple and Compound Interest",
        "Probability",
        "Permutations and Combinations",
        "Number Systems",
        "Data Interpretation",
    ),
    "logical": (
        "Number Series",
        "Coding and Decoding",
        "Blood Relations",
        "Direction Sense",
        "Syllogisms",
        "Seating Arrangement",
        "Logical Puzzles",
        "Data Sufficiency",
    ),
    "verbal": (
        "Reading Comprehension",
        "Sentence Correction",
        "Synonyms and Antonyms",
        "Grammar",
        "Para Jumbles",
        "Vocabulary",
    ),
    "programming": (
        "C Programming",
        "C++ Programming",
        "Java Programming",
        "Python Programming",
        "JavaScript",
        "Output Prediction",
        "Loops and Functions",
        "Recursion",
    ),
    "cs_fundamentals": (
        "DBMS and SQL",
        "SQL Joins",
        "Operating Systems",
        "Computer Networks",
        "Object-Oriented Programming",
        "Data Structures",
        "Algorithms",
        "Time Complexity",
    ),
    "pseudocode": (
        "Pseudocode Output",
        "Logic Tracing",
        "Error Identification",
        "Basic Debugging",
        "Conditional Statements",
        "Loops and Arrays",
    ),
}

DIFFICULTIES = ("easy", "medium", "hard")
QUESTION_COUNTS = (5, 10, 20)


def validate_aptitude_request(
    category: str,
    topic: str,
    difficulty: str,
    question_count: int,
) -> None:
    if category not in APTITUDE_TOPICS:
        raise MockTestError("Invalid aptitude category.")

    if topic not in APTITUDE_TOPICS[category]:
        raise MockTestError("Invalid topic for selected category.")

    if difficulty not in DIFFICULTIES:
        raise MockTestError("Invalid difficulty.")

    if question_count not in QUESTION_COUNTS:
        raise MockTestError("Choose 5, 10 or 20 questions.")


def test_duration_seconds(question_count: int) -> int:
    if question_count not in QUESTION_COUNTS:
        raise MockTestError("Invalid question count.")

    return question_count * 90


async def generate_aptitude_questions(
    *,
    category: str,
    topic: str,
    difficulty: str,
    question_count: int,
    ai_caller,
):
    """Generate a complete validated aptitude test in bounded batches."""
    import json
    from app.student_mock_tests import validate_questions

    validate_aptitude_request(
        category, topic, difficulty, question_count
    )

    questions = []
    seen = set()
    provider = None
    model = None

    for attempt in range(3):
        missing = question_count - len(questions)

        if missing <= 0:
            break

        existing = [
            item["question"] for item in questions
        ]

        messages = [
            {
                "role": "system",
                "content": (
                    "Generate placement aptitude multiple-choice questions. "
                    "Return ONLY valid JSON in the format "
                    '{"questions":[{"question":"...",'
                    '"options":{"A":"...","B":"...","C":"...","D":"..."},'
                    '"correct_answer":"A","explanation":"..."}]}. '
                    "Every question must have four distinct options, "
                    "one correct answer and a clear explanation. "
                    "Do not include Markdown or introductory text."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Category: {category}\\n"
                    f"Topic: {topic}\\n"
                    f"Difficulty: {difficulty}\\n"
                    f"Generate exactly {missing} NEW questions. "
                    "Do not repeat these questions: "
                    + json.dumps(existing)
                ),
            },
        ]

        result = await ai_caller(
            messages=messages,
            max_tokens=min(12000, 1000 + missing * 550),
        )

        provider = result.get("provider", provider)
        model = result.get("model", model)

        raw = result.get("answer", "")

        # Extract JSON without requiring the model to produce
        # exactly the requested number of questions.
        import json as json_module

        decoder = json_module.JSONDecoder()
        payload = None

        if isinstance(raw, str):
            for index, char in enumerate(raw):
                if char != "{":
                    continue

                try:
                    candidate, _ = decoder.raw_decode(raw[index:])
                except json_module.JSONDecodeError:
                    continue

                if (
                    isinstance(candidate, dict)
                    and isinstance(candidate.get("questions"), list)
                ):
                    payload = candidate["questions"]
                    break

        if payload is None:
            if attempt < 2:
                continue
            break

        # Validate questions individually, preserving only
        # structurally valid and nonduplicate questions.
        for candidate in payload:
            if len(questions) >= question_count:
                break

            try:
                validated = validate_questions([candidate], 1)
            except MockTestError:
                continue

            item = validated[0]
            normalized = " ".join(
                item["question"].casefold().split()
            )

            if normalized in seen:
                continue

            seen.add(normalized)
            questions.append(item)

    if len(questions) != question_count:
        raise MockTestError(
            f"Could not generate {question_count} valid questions. "
            f"Received {len(questions)} after 3 attempts."
        )

    questions = validate_questions(questions, question_count)

    return {
        "questions": questions,
        "provider": provider,
        "model": model,
        "duration_seconds": test_duration_seconds(question_count),
    }


__all__ = [
    "APTITUDE_TOPICS",
    "DIFFICULTIES",
    "QUESTION_COUNTS",
    "MockTestError",
    "public_questions",
    "grade_mock_test",
    "validate_aptitude_request",
    "test_duration_seconds",
    "generate_aptitude_questions",
]


def parse_aptitude_questions(raw_answer: str, expected_count: int):
    """Parse valid question JSON, allowing surrounding model text."""
    import json
    from app.student_mock_tests import validate_questions

    try:
        return parse_questions(raw_answer, expected_count)
    except MockTestError as exc:
        if "invalid JSON" not in str(exc):
            raise

    if not isinstance(raw_answer, str):
        raise MockTestError("AI returned invalid JSON.")

    decoder = json.JSONDecoder()

    # Locate a complete JSON object, without attempting to
    # reconstruct truncated or malformed model output.
    for index, char in enumerate(raw_answer):
        if char != "{":
            continue

        try:
            payload, _ = decoder.raw_decode(raw_answer[index:])
        except json.JSONDecodeError:
            continue

        if not isinstance(payload, dict):
            continue

        if "questions" not in payload:
            continue

        return validate_questions(
            payload["questions"],
            expected_count,
        )

    raise MockTestError("AI returned invalid JSON.")
