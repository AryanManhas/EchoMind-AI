from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "info"
    
    ELASTICSEARCH_URL: str = "http://localhost:9200"
    REDIS_URL: str = "redis://localhost:6379/0"
    
    MODEL_NAME: str = "bert-base-uncased"
    USE_QUANTIZATION: bool = True
    MAX_SEQ_LENGTH: int = 512
    
    API_KEY: str | None = None

    class Config:
        env_file = ".env"

settings = Settings()
