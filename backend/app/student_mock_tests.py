"""AI mock-test generation and server-side scoring."""

import json
import re


class MockTestError(ValueError):
    pass


def validate_questions(payload, expected_count: int):
    """Validate structured AI output before saving a test."""

    if not isinstance(payload, list):
        raise MockTestError("AI response must contain a question list.")

    if len(payload) != expected_count:
        raise MockTestError(
            f"Expected {expected_count} questions, received {len(payload)}."
        )

    validated = []

    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise MockTestError(f"Question {index} is invalid.")

        question = item.get("question")
        options = item.get("options")
        correct_answer = item.get("correct_answer")
        explanation = item.get("explanation")

        if not isinstance(question, str) or not question.strip():
            raise MockTestError(f"Question {index} has no question text.")

        if not isinstance(options, dict):
            raise MockTestError(f"Question {index} has invalid options.")

        if set(options) != {"A", "B", "C", "D"}:
            raise MockTestError(
                f"Question {index} must contain options A, B, C and D."
            )

        if not all(
            isinstance(value, str) and value.strip()
            for value in options.values()
        ):
            raise MockTestError(f"Question {index} has empty options.")

        if len({value.strip().casefold() for value in options.values()}) != 4:
            raise MockTestError(f"Question {index} has duplicate options.")

        if correct_answer not in ("A", "B", "C", "D"):
            raise MockTestError(
                f"Question {index} has an invalid answer key."
            )

        if not isinstance(explanation, str) or not explanation.strip():
            raise MockTestError(
                f"Question {index} requires an explanation."
            )

        validated.append({
            "question": question.strip(),
            "options": {
                key: options[key].strip()
                for key in ("A", "B", "C", "D")
            },
            "correct_answer": correct_answer,
            "explanation": explanation.strip(),
        })

    return validated


def parse_questions(raw_answer: str, expected_count: int):
    """Parse an AI JSON response, allowing surrounding Markdown fences."""

    if not isinstance(raw_answer, str) or not raw_answer.strip():
        raise MockTestError("AI returned an empty response.")

    text = raw_answer.strip()

    text = re.sub(
        r"^```(?:json)?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\s*```$", "", text)

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise MockTestError("AI returned invalid JSON.") from exc

    if isinstance(payload, dict):
        payload = payload.get("questions")

    return validate_questions(payload, expected_count)


async def generate_mock_questions(
    *,
    subject: str,
    topic: str,
    question_count: int,
    ai_caller,
):
    """Generate and validate MCQs using the existing provider gateway."""

    if not 3 <= question_count <= 10:
        raise MockTestError("Choose between 3 and 10 questions.")

    if not subject.strip() or not topic.strip():
        raise MockTestError("Subject and topic are required.")

    messages = [
        {
            "role": "system",
            "content": (
                "You create accurate academic multiple-choice tests. "
                "Return ONLY valid JSON. "
                "Use the schema: "
                '{"questions":[{"question":"...",'
                '"options":{"A":"...","B":"...","C":"...","D":"..."},'
                '"correct_answer":"A","explanation":"..."}]}. '
                "Each question must have exactly one correct option. "
                "Use four distinct options. "
                "Avoid ambiguous questions and unsupported claims. "
                "Do not include Markdown fences."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Subject: {subject}\n"
                f"Topic: {topic}\n"
                f"Generate exactly {question_count} MCQs. "
                "Use a mixture of conceptual and application questions. "
                "Provide a short explanation for each correct answer."
            ),
        },
    ]

    result = await ai_caller(
        messages=messages,
        max_tokens=3500,
    )

    questions = parse_questions(
        result.get("answer", ""),
        question_count,
    )

    return {
        "questions": questions,
        "provider": result.get("provider"),
        "model": result.get("model"),
    }


def public_questions(questions):
    """Remove answer keys and explanations before sending a test."""

    return [
        {
            "number": index,
            "question": item["question"],
            "options": item["options"],
        }
        for index, item in enumerate(questions, start=1)
    ]


def grade_mock_test(questions, submitted_answers):
    """Grade submitted answers exclusively on the backend."""

    if not isinstance(submitted_answers, dict):
        raise MockTestError("Answers must be a JSON object.")

    total = len(questions)

    if total == 0:
        raise MockTestError("Mock test has no questions.")

    allowed_keys = {str(index) for index in range(1, total + 1)}

    if not set(submitted_answers).issubset(allowed_keys):
        raise MockTestError("Submitted answers contain invalid question IDs.")

    if any(
        answer not in ("A", "B", "C", "D")
        for answer in submitted_answers.values()
    ):
        raise MockTestError("Submitted answers contain invalid options.")

    correct = 0
    review = []

    for index, item in enumerate(questions, start=1):
        answer = submitted_answers.get(str(index))
        expected = item["correct_answer"]
        is_correct = answer == expected

        if is_correct:
            correct += 1

        review.append({
            "number": index,
            "submitted_answer": answer,
            "correct_answer": expected,
            "is_correct": is_correct,
            "explanation": item["explanation"],
        })

    percentage = round(correct * 100 / total, 2)

    return {
        "correct_count": correct,
        "total_questions": total,
        "score_percentage": percentage,
        "passed": percentage >= 80,
        "review": review,
    }
