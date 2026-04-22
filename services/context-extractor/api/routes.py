from fastapi import APIRouter, HTTPException, Depends
from schemas.payloads import ExtractionRequest, BatchExtractionRequest, ExtractionResponse
from core.extractor import ContextExtractor
import time
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

# Dependency for dependency injection
def get_extractor() -> ContextExtractor:
    # In a real app, this might be cached or injected
    return ContextExtractor()

@router.post("/extract", response_model=ExtractionResponse)
async def extract_context(
    request: ExtractionRequest,
    extractor: ContextExtractor = Depends(get_extractor)
):
    start_time = time.time()
    try:
        context_data = await extractor.extract(
            text=request.text, 
            session_id=request.session_id,
            preserve=request.preserve_context
        )
        latency = (time.time() - start_time) * 1000
        
        return ExtractionResponse(
            success=True,
            data=context_data,
            latency_ms=latency
        )
    except Exception as e:
        logger.error(f"Extraction failed: {str(e)}")
        latency = (time.time() - start_time) * 1000
        return ExtractionResponse(
            success=False,
            latency_ms=latency,
            error=str(e)
        )

@router.post("/extract/batch")
async def extract_batch(
    request: BatchExtractionRequest,
    extractor: ContextExtractor = Depends(get_extractor)
):
    # Implementation for batch processing
    start_time = time.time()
    results = []
    try:
        for text in request.texts:
            data = await extractor.extract(text, request.session_id, preserve=False)
            results.append(data)
        
        return {
            "success": True,
            "data": results,
            "latency_ms": (time.time() - start_time) * 1000
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
