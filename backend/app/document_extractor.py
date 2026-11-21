
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader
from docx import Document


MAX_EXTRACTED_CHARACTERS = 100_000
MAX_PDF_PAGES = 150


class DocumentExtractionError(Exception):
    pass


def extract_pdf(content: bytes) -> str:
    reader = PdfReader(BytesIO(content))

    if reader.is_encrypted:
        raise DocumentExtractionError(
            "Password-protected PDFs are not supported."
        )

    if len(reader.pages) > MAX_PDF_PAGES:
        raise DocumentExtractionError(
            "PDF exceeds the 150-page processing limit."
        )

    sections = []
    total_characters = 0

    for page_number, page in enumerate(
        reader.pages,
        start=1,
    ):
        text = (page.extract_text() or "").strip()

        if not text:
            continue

        section = f"[Page {page_number}]\n{text}"

        total_characters += len(section) + 2

        if total_characters > MAX_EXTRACTED_CHARACTERS:
            raise DocumentExtractionError(
                "Document contains too much text. "
                "Please split it into smaller documents."
            )

        sections.append(section)

    return "\n\n".join(sections)


def extract_docx(content: bytes) -> str:
    document = Document(BytesIO(content))

    sections = []

    for paragraph in document.paragraphs:
        text = paragraph.text.strip()

        if text:
            sections.append(text)

    for table_number, table in enumerate(
        document.tables,
        start=1,
    ):
        sections.append(f"[Table {table_number}]")

        for row in table.rows:
            cells = [
                cell.text.strip()
                for cell in row.cells
            ]

            sections.append(" | ".join(cells))

    return "\n\n".join(sections)


def extract_txt(content: bytes) -> str:
    return content.decode("utf-8-sig").strip()


def extract_document_text(
    filename: str,
    content: bytes,
) -> dict:

    extension = Path(filename).suffix.lower()

    if not content:
        raise DocumentExtractionError(
            "The document is empty."
        )

    try:
        if extension == ".pdf":
            text = extract_pdf(content)

        elif extension == ".docx":
            text = extract_docx(content)

        elif extension == ".txt":
            text = extract_txt(content)

        elif extension in (".jpg", ".jpeg", ".png"):
            raise DocumentExtractionError(
                "Image text extraction requires OCR. "
                "OCR support is not available yet."
            )

        else:
            raise DocumentExtractionError(
                "Unsupported document format."
            )

    except DocumentExtractionError:
        raise

    except Exception as exc:
        raise DocumentExtractionError(
            "Unable to extract document content."
        ) from exc

    text = text.strip()

    if not text:
        raise DocumentExtractionError(
            "No readable text was found. "
            "Scanned documents may require OCR."
        )

    if len(text) > MAX_EXTRACTED_CHARACTERS:
        raise DocumentExtractionError(
            "Document contains too much text. "
            "Please split it into smaller documents."
        )

    return {
        "filename": filename,
        "file_type": extension.lstrip("."),
        "text": text,
        "character_count": len(text),
        "word_count": len(text.split()),
    }
