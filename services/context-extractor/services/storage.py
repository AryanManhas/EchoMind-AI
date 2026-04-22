from elasticsearch import Elasticsearch
import logging
from core.config import settings

logger = logging.getLogger(__name__)

class StorageService:
    def __init__(self):
        try:
            self.client = Elasticsearch(settings.ELASTICSEARCH_URL)
            logger.info("Connected to Elasticsearch.")
            self._ensure_index()
        except Exception as e:
            logger.warning(f"Failed to connect to Elasticsearch: {e}")
            self.client = None

    def _ensure_index(self):
        if not self.client:
            return
        index_name = "extracted_contexts"
        if not self.client.indices.exists(index=index_name):
            self.client.indices.create(index=index_name, body={
                "mappings": {
                    "properties": {
                        "session_id": {"type": "keyword"},
                        "timestamp": {"type": "date"},
                        "entities": {"type": "nested"},
                        "categories": {"type": "object"},
                        "metadata": {"type": "object"}
                    }
                }
            })
            logger.info(f"Created index {index_name}")

    def save_document(self, index: str, document: dict):
        if not self.client:
            return
        try:
            self.client.index(index=index, document=document)
        except Exception as e:
            logger.error(f"Elasticsearch save error: {e}")
