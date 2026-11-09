from fastapi import FastAPI

app = FastAPI(title="Multi-Agent AI Platform API")


@app.get("/health")
def health_check():
    return {"status": "ok"}