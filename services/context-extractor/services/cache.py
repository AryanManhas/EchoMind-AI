import redis
import json
import logging
from core.config import settings

logger = logging.getLogger(__name__)

class CacheService:
    def __init__(self):
        try:
            self.client = redis.from_url(settings.REDIS_URL, decode_responses=True)
            logger.info("Connected to Redis cache.")
        except Exception as e:
            logger.warning(f"Failed to connect to Redis: {e}")
            self.client = None

    def get_context(self, session_id: str):
        if not self.client:
            return None
        try:
            data = self.client.get(f"context:{session_id}")
            return json.loads(data) if data else None
        except Exception as e:
            logger.error(f"Redis get error: {e}")
            return None

    def save_context(self, session_id: str, context_data: dict, ttl: int = 3600):
        if not self.client:
            return
        try:
            self.client.setex(f"context:{session_id}", ttl, json.dumps(context_data))
        except Exception as e:
            logger.error(f"Redis set error: {e}")
