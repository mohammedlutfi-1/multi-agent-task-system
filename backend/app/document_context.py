
import re


DEFAULT_CHUNK_SIZE = 6000
DEFAULT_CHUNK_OVERLAP = 400
MAX_CONTEXT_CHARACTERS = 18000
MAX_SELECTED_CHUNKS = 3


def clean_document_text(text: str) -> str:
    text = text.replace("\r\n", "\n")
    text = text.replace("\r", "\n")
    text = text.replace("\x00", "")

    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]+\n", "\n\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


def chunk_document(
    text: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> list[dict]:

    if chunk_size <= 0:
        raise ValueError("Chunk size must be positive.")

    if overlap < 0 or overlap >= chunk_size:
        raise ValueError("Invalid chunk overlap.")

    text = clean_document_text(text)

    if not text:
        return []

    chunks = []
    start = 0

    while start < len(text):
        end = min(start + chunk_size, len(text))

        if end < len(text):
            boundary = text.rfind(
                "\n\n",
                start + chunk_size // 2,
                end,
            )

            if boundary == -1:
                boundary = text.rfind(
                    " ",
                    start + chunk_size // 2,
                    end,
                )

            if boundary > start + overlap:
                end = boundary

        chunk_text = text[start:end].strip()

        if chunk_text:
            chunks.append({
                "chunk_id": len(chunks) + 1,
                "text": chunk_text,
                "character_count": len(chunk_text),
                "start": start,
                "end": end,
            })

        if end >= len(text):
            break

        start = max(start + 1, end - overlap)

    return chunks


def tokenize(text: str) -> set[str]:
    return set(re.findall(r"\w+", text.lower()))


def select_relevant_chunks(
    chunks: list[dict],
    query: str,
    max_chunks: int = MAX_SELECTED_CHUNKS,
) -> list[dict]:

    if not chunks or max_chunks <= 0:
        return []

    query_tokens = tokenize(query)

    if not query_tokens:
        return chunks[:max_chunks]

    ranked_chunks = []

    for chunk in chunks:
        chunk_tokens = tokenize(chunk["text"])

        matched_tokens = (
            query_tokens & chunk_tokens
        )

        score = len(matched_tokens) / len(query_tokens)

        ranked_chunks.append({
            **chunk,
            "relevance_score": score,
        })

    ranked_chunks.sort(
        key=lambda item: item["relevance_score"],
        reverse=True,
    )

    selected = ranked_chunks[:max_chunks]

    selected.sort(
        key=lambda item: item["chunk_id"]
    )

    return selected


def build_ai_context(
    chunks: list[dict],
    max_characters: int = MAX_CONTEXT_CHARACTERS,
) -> str:

    sections = []
    used_characters = 0

    for chunk in chunks:
        section = (
            f"[Document Chunk {chunk['chunk_id']}]\n"
            f"{chunk['text']}"
        )

        separator = "\n\n" if sections else ""

        remaining = max_characters - used_characters

        if remaining <= len(separator):
            break

        section = section[
            :remaining - len(separator)
        ]

        sections.append(separator + section)

        used_characters += (
            len(separator) + len(section)
        )

    return "".join(sections)
