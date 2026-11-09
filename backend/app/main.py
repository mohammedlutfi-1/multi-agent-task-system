import os

from dotenv import load_dotenv
from fastapi import FastAPI

load_dotenv()

app = FastAPI(title="Multi-Agent AI Platform API")


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/config-check")
def config_check():
    return {
        "supabase_url_configured": bool(os.getenv("SUPABASE_URL")),
        "supabase_service_key_configured": bool(
            os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        ),
    }