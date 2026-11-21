
import asyncio
import logging
from io import BytesIO
from pathlib import Path
from uuid import UUID, uuid4
from zipfile import ZipFile

import httpx
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from PIL import Image
from pypdf import PdfReader
from docx import Document

from app.document_extractor import (
    extract_document_text,
    DocumentExtractionError,
)

from app.auth import verify_user
from app.database import (
    create_supabase_client,
    get_supabase_config,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/student/documents",
    tags=["Student Documents"],
)

BUCKET_NAME = "student-documents"

MAX_FILE_SIZE = 10 * 1024 * 1024
MAX_USER_STORAGE = 50 * 1024 * 1024

MAX_DOCUMENTS_PER_USER = 25

MAX_IMAGE_PIXELS = 20_000_000

MAX_DOCX_UNCOMPRESSED_SIZE = 50 * 1024 * 1024

ALLOWED_FILE_TYPES = {
    ".pdf": "application/pdf",
    ".docx": (
        "application/vnd.openxmlformats-officedocument"
        ".wordprocessingml.document"
    ),
    ".txt": "text/plain",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}


def validate_filename(filename: str) -> tuple[str, str]:
    filename = filename.replace("\\", "/").split("/")[-1]

    if not filename.strip() or len(filename) > 255:
        raise HTTPException(
            status_code=400,
            detail="Invalid file name.",
        )

    if any(ord(char) < 32 or ord(char) == 127 for char in filename):
        raise HTTPException(
            status_code=400,
            detail="Invalid characters in file name.",
        )

    extension = Path(filename).suffix.lower()

    if extension not in ALLOWED_FILE_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Supported formats: PDF, DOCX, TXT, JPG and PNG.",
        )

    return filename, extension


def validate_file_content(
    content: bytes,
    extension: str,
) -> None:
    try:
        if extension == ".pdf":
            if not content.startswith(b"%PDF-"):
                raise ValueError("Invalid PDF signature")

            reader = PdfReader(BytesIO(content))

            if reader.is_encrypted:
                raise HTTPException(
                    status_code=400,
                    detail="Password-protected PDFs are not supported.",
                )

            if len(reader.pages) == 0:
                raise ValueError("Empty PDF")

        elif extension == ".docx":
            with ZipFile(BytesIO(content)) as archive:
                entries = archive.infolist()

                total_size = sum(
                    entry.file_size for entry in entries
                )

                if (
                    total_size > MAX_DOCX_UNCOMPRESSED_SIZE
                    or len(entries) > 2000
                ):
                    raise HTTPException(
                        status_code=413,
                        detail="Word document is too complex or large.",
                    )

                if "word/document.xml" not in archive.namelist():
                    raise ValueError("Invalid DOCX structure")

            Document(BytesIO(content))

        elif extension == ".txt":
            decoded = content.decode("utf-8-sig")

            if "\x00" in decoded or not decoded.strip():
                raise ValueError("Invalid or empty text file")

        elif extension in (".jpg", ".jpeg", ".png"):
            with Image.open(BytesIO(content)) as image:
                expected_format = (
                    "PNG" if extension == ".png" else "JPEG"
                )

                if image.format != expected_format:
                    raise ValueError("Image format mismatch")

                if image.width * image.height > MAX_IMAGE_PIXELS:
                    raise HTTPException(
                        status_code=413,
                        detail="Image resolution is too large.",
                    )

                image.verify()

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is invalid or corrupted.",
        ) from exc


async def read_and_validate_file(
    file: UploadFile,
) -> tuple[str, str, bytes]:

    try:
        filename, extension = validate_filename(
            file.filename or ""
        )

        content = await file.read(MAX_FILE_SIZE + 1)

        if not content:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is empty.",
            )

        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="Maximum file size is 10 MB.",
            )

        await asyncio.to_thread(
            validate_file_content,
            content,
            extension,
        )

        return (
            filename,
            ALLOWED_FILE_TYPES[extension],
            content,
        )

    finally:
        await file.close()


def create_storage_client():
    url, key = get_supabase_config()

    return httpx.AsyncClient(
        base_url=f"{url}/storage/v1/",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
        },
        timeout=60.0,
    )

async def check_document_quota(
    user_id: str,
    new_file_size: int,
) -> None:

    async with create_supabase_client() as client:
        response = await client.get(
            "student_documents",
            params={
                "select": "file_size",
                "user_id": f"eq.{user_id}",
                "limit": str(MAX_DOCUMENTS_PER_USER),
            },
        )

        response.raise_for_status()

        documents = response.json()

    document_count = len(documents)

    used_bytes = sum(
        int(doc["file_size"])
        for doc in documents
    )

    if document_count >= MAX_DOCUMENTS_PER_USER:
        raise HTTPException(
            status_code=409,
            detail=(
                "Maximum limit of 25 documents reached. "
                "Delete unused documents before uploading."
            ),
        )

    if used_bytes + new_file_size > MAX_USER_STORAGE:
        remaining_bytes = max(
            0,
            MAX_USER_STORAGE - used_bytes,
        )

        remaining_mb = remaining_bytes / (1024 * 1024)

        raise HTTPException(
            status_code=413,
            detail=(
                "Storage quota exceeded. "
                f"Available storage: {remaining_mb:.2f} MB. "
                "Delete unused documents to free up space."
            ),
        )

async def verify_subject_owner(
    user_id: str,
    subject_id: str,
) -> None:

    async with create_supabase_client() as client:
        response = await client.get(
            "student_subjects",
            params={
                "select": "id",
                "id": f"eq.{subject_id}",
                "user_id": f"eq.{user_id}",
                "limit": "1",
            },
        )

        response.raise_for_status()

        if not response.json():
            raise HTTPException(
                status_code=404,
                detail="Subject not found.",
            )


async def get_owned_document(
    user_id: str,
    document_id: str,
) -> dict:

    async with create_supabase_client() as client:
        response = await client.get(
            "student_documents",
            params={
                "select": "*",
                "id": f"eq.{document_id}",
                "user_id": f"eq.{user_id}",
                "limit": "1",
            },
        )

        response.raise_for_status()

        records = response.json()

        if not records:
            raise HTTPException(
                status_code=404,
                detail="Document not found.",
            )

        return records[0]


async def remove_storage_file(storage_path: str):
    async with create_storage_client() as client:
        response = await client.request(
            "DELETE",
            f"object/{BUCKET_NAME}",
            json={"prefixes": [storage_path]},
        )

        response.raise_for_status()


@router.post("/upload", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    subject_id: str | None = Form(None),
    description: str | None = Form(None),
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))
    title = title.strip()
    description = (description or "").strip()

    if not title or len(title) > 200:
        await file.close()
        raise HTTPException(
            status_code=400,
            detail="Title must contain 1 to 200 characters.",
        )

    if len(description) > 2000:
        await file.close()
        raise HTTPException(
            status_code=400,
            detail="Description cannot exceed 2000 characters.",
        )

    filename, file_type, content = (
        await read_and_validate_file(file)
    )

    subject_id = (subject_id or "").strip() or None

    if subject_id:
        try:
            subject_id = str(UUID(subject_id))

        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Invalid subject ID.",
            )

    document_id = str(uuid4())
    extension = Path(filename).suffix.lower()

    storage_path = (
        f"{user_id}/{document_id}{extension}"
    )

    uploaded = False

    try:
        if subject_id:
            await verify_subject_owner(
                user_id,
                subject_id,
            )

        await check_document_quota(
            user_id,
            len(content),
        )

        async with create_storage_client() as client:
            response = await client.post(
                f"object/{BUCKET_NAME}/{storage_path}",
                content=content,
                headers={
                    "Content-Type": file_type,
                    "x-upsert": "false",
                },
            )

            response.raise_for_status()
            uploaded = True

        payload = {
            "id": document_id,
            "user_id": user_id,
            "subject_id": subject_id,
            "title": title,
            "file_name": filename,
            "file_type": file_type,
            "file_size": len(content),
            "storage_path": storage_path,
            "description": description or None,
        }

        async with create_supabase_client() as client:
            response = await client.post(
                "student_documents",
                json=payload,
                headers={
                    "Prefer": "return=representation",
                },
            )

            response.raise_for_status()

            records = response.json()

            if not records:
                raise RuntimeError(
                    "Document metadata was not returned."
                )

        return {
            "message": "Document uploaded successfully.",
            "document": records[0],
        }

    except HTTPException:
        raise

    except Exception as exc:
        if uploaded:
            try:
                # Check whether metadata was committed before
                # attempting to remove the uploaded object.
                await get_owned_document(
                    user_id,
                    document_id,
                )

            except HTTPException as lookup_error:
                if lookup_error.status_code == 404:
                    try:
                        await remove_storage_file(
                            storage_path
                        )

                    except Exception:
                        logger.error(
                            "Document cleanup failed: %s",
                            document_id,
                        )

            except Exception:
                logger.error(
                    "Document state uncertain: %s",
                    document_id,
                )
        if isinstance(exc, httpx.HTTPStatusError):
            try:
                error_data = exc.response.json()
                error_message = str(
                    error_data.get("message", "")
                )
            except (ValueError, AttributeError):
                error_message = ""

            if "Maximum document limit reached" in error_message:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Maximum limit of 25 documents reached. "
                        "Delete unused documents before uploading."
                    ),
                ) from exc

            if "Storage quota exceeded" in error_message:
                raise HTTPException(
                    status_code=413,
                    detail=(
                        "Storage quota of 50 MB exceeded. "
                        "Delete unused documents to free up space."
                    ),
                ) from exc

            if "Maximum file size" in error_message:
                raise HTTPException(
                    status_code=413,
                    detail="Maximum file size is 10 MB.",
                ) from exc

        logger.error(
            "Document upload failed: %s",
            type(exc).__name__,
        )

        raise HTTPException(
            status_code=502,
            detail="Upload could not be confirmed. Refresh your documents before retrying.",
        ) from exc


@router.get("")
async def list_documents(
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))

    try:
        async with create_supabase_client() as client:
            response = await client.get(
                "student_documents",
                params={
                    "select": "*",
                    "user_id": f"eq.{user_id}",
                    "order": "created_at.desc",
                },
            )

            response.raise_for_status()

            return {"documents": response.json()}

    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to retrieve documents.",
        ) from exc


@router.delete("/{document_id}")
async def delete_document(
    document_id: UUID,
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))
    document_id = str(document_id)

    try:
        document = await get_owned_document(
            user_id,
            document_id,
        )

        storage_path = document["storage_path"]

        if not storage_path.startswith(f"{user_id}/"):
            raise HTTPException(
                status_code=403,
                detail="Invalid document ownership.",
            )

        await remove_storage_file(storage_path)

        async with create_supabase_client() as client:
            response = await client.delete(
                "student_documents",
                params={
                    "id": f"eq.{document_id}",
                    "user_id": f"eq.{user_id}",
                },
            )

            response.raise_for_status()

        return {
            "message": "Document deleted successfully.",
            "deleted": True,
        }

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to complete document deletion. Please retry.",
        ) from exc


from fastapi.responses import Response
from urllib.parse import quote


@router.get("/{document_id}/download")
async def download_document(
    document_id: UUID,
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))

    try:
        document = await get_owned_document(
            user_id,
            str(document_id),
        )

        storage_path = document["storage_path"]

        if not storage_path.startswith(f"{user_id}/"):
            raise HTTPException(
                status_code=403,
                detail="Invalid document ownership.",
            )

        async with create_storage_client() as client:
            response = await client.get(
                f"object/authenticated/{BUCKET_NAME}/{storage_path}"
            )

            response.raise_for_status()

            content = response.content

        filename = quote(
            document["file_name"],
            safe="",
        )

        return Response(
            content=content,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": (
                    f"attachment; filename*=UTF-8''{filename}"
                ),
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    except HTTPException:
        raise

    except Exception as exc:
        logger.error(
            "Document download failed: %s",
            type(exc).__name__,
        )

        raise HTTPException(
            status_code=502,
            detail="Unable to download document.",
        ) from exc


@router.post("/{document_id}/extract")
async def extract_uploaded_document(
    document_id: UUID,
    user: dict = Depends(verify_user),
):
    user_id = str(UUID(user["sub"]))

    try:
        document = await get_owned_document(
            user_id,
            str(document_id),
        )

        storage_path = document["storage_path"]

        if not storage_path.startswith(f"{user_id}/"):
            raise HTTPException(
                status_code=403,
                detail="Invalid document ownership.",
            )

        async with create_storage_client() as client:
            response = await client.get(
                f"object/authenticated/{BUCKET_NAME}/{storage_path}"
            )

            response.raise_for_status()

            content = response.content

        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="Document exceeds the processing size limit.",
            )

        result = await asyncio.to_thread(
            extract_document_text,
            document["file_name"],
            content,
        )

        return {
            "message": "Document extracted successfully.",
            "document_id": str(document_id),
            "title": document["title"],
            **result,
        }

    except DocumentExtractionError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    except HTTPException:
        raise

    except Exception as exc:
        logger.error(
            "Document extraction failed: %s",
            type(exc).__name__,
        )

        raise HTTPException(
            status_code=502,
            detail="Unable to process the document.",
        ) from exc
