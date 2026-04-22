from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router as api_router
from core.config import settings
import logging

logging.basicConfig(level=settings.LOG_LEVEL.upper())
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Context Extraction API",
    description="Microservice for extracting context, entities, and categories from unstructured text.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")

@app.on_event("startup")
async def startup_event():
    logger.info("Starting up Context Extraction Service...")
    # Initialize models and connections here

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down Context Extraction Service...")
    # Close connections here

@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "1.0.0"}

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Global error handler: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error"}
    )
