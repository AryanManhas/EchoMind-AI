import logging
import datetime
from models.ner_model import NERModel
from services.cache import CacheService
from services.storage import StorageService
from schemas.payloads import ExtractedContext, ExtractedEntity

logger = logging.getLogger(__name__)

class ContextExtractor:
    def __init__(self):
        # In a real app, these would be singletons injected via dependency injection
        self.ner_model = NERModel()
        self.cache = CacheService()
        self.storage = StorageService()

    def _filter_noise(self, text: str) -> str:
        # Placeholder for noise filtering logic
        return text.strip()

    def _detect_categories(self, text: str) -> list:
        # Placeholder for zero-shot classification or taxonomy matching
        return [{"general": 0.8}, {"technology": 0.6}]

    def _detect_intents(self, text: str) -> list:
        # Placeholder for intent detection
        return [{"information_retrieval": 0.9}]

    async def extract(self, text: str, session_id: str = None, preserve: bool = True) -> dict:
        logger.info(f"Extracting context for session: {session_id}")
        
        # 1. Check Cache for existing context if preserve is true
        previous_context = None
        if preserve and session_id:
            previous_context = self.cache.get_context(session_id)

        # 2. Preprocess
        clean_text = self._filter_noise(text)

        # 3. Model Inference (NER & Relationships)
        raw_entities = self.ner_model.predict(clean_text)
        
        # 4. Semantic Categorization & Intents
        categories = self._detect_categories(clean_text)
        intents = self._detect_intents(clean_text)

        # 5. Build Context Object
        context_data = {
            "entities": raw_entities,
            "categories": categories,
            "intents": intents,
            "metadata": {
                "timestamp": datetime.datetime.utcnow().isoformat(),
                "has_previous_context": previous_context is not None
            }
        }

        # 6. Context Preservation (Cache & Storage)
        if session_id:
            # Merge logic would go here if previous_context exists
            if preserve:
                self.cache.save_context(session_id, context_data)
            
            # Async save to elasticsearch
            doc_to_save = context_data.copy()
            doc_to_save["session_id"] = session_id
            self.storage.save_document("extracted_contexts", doc_to_save)

        return context_data
