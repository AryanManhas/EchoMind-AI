from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

class ExtractionRequest(BaseModel):
    text: str
    session_id: Optional[str] = None
    preserve_context: bool = True
    domain: Optional[str] = "general"

class BatchExtractionRequest(BaseModel):
    texts: List[str]
    session_id: Optional[str] = None

class ExtractedEntity(BaseModel):
    text: str
    label: str
    start: int
    end: int
    confidence: float

class ExtractedContext(BaseModel):
    entities: List[ExtractedEntity]
    categories: List[Dict[str, float]] # e.g. {"technology": 0.95}
    intents: List[Dict[str, float]]
    metadata: Dict[str, Any] = Field(default_factory=dict)

class ExtractionResponse(BaseModel):
    success: bool
    data: Optional[ExtractedContext]
    latency_ms: float
    error: Optional[str] = None
