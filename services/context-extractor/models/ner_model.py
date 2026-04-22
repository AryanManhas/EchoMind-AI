import torch
from transformers import AutoTokenizer, AutoModelForTokenClassification
import logging
from core.config import settings

logger = logging.getLogger(__name__)

class NERModel:
    def __init__(self):
        self.model_name = settings.MODEL_NAME
        self.use_quantization = settings.USE_QUANTIZATION
        self.device = "cpu" # Quantization usually targets CPU
        
        self.tokenizer = None
        self.model = None
        self._load_model()

    def _load_model(self):
        try:
            logger.info(f"Loading tokenizer and model: {self.model_name}")
            # For demonstration, we use a basic pre-trained model.
            # In production, this would be a custom trained PyTorch model.
            self.tokenizer = AutoTokenizer.from_pretrained("dslim/bert-base-NER")
            self.model = AutoModelForTokenClassification.from_pretrained("dslim/bert-base-NER")
            
            if self.use_quantization:
                logger.info("Applying dynamic quantization for production readiness...")
                # Apply dynamic quantization to Linear layers to reduce memory and speed up CPU inference
                self.model = torch.quantization.quantize_dynamic(
                    self.model, {torch.nn.Linear}, dtype=torch.qint8
                )
                logger.info("Quantization applied successfully.")
                
            self.model.eval()
            self.model.to(self.device)
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise

    def predict(self, text: str):
        if not self.model or not self.tokenizer:
            raise RuntimeError("Model not initialized")
            
        inputs = self.tokenizer(text, return_tensors="pt", truncation=True, max_length=settings.MAX_SEQ_LENGTH).to(self.device)
        
        with torch.no_grad():
            outputs = self.model(**inputs)
            
        predictions = torch.argmax(outputs.logits, dim=2)
        
        # Convert predictions to entity format
        tokens = self.tokenizer.convert_ids_to_tokens(inputs["input_ids"][0])
        
        entities = []
        # Basic parsing of tokens (simplified for demonstration)
        for i, (token, pred) in enumerate(zip(tokens, predictions[0])):
            if pred.item() != 0 and token not in ['[CLS]', '[SEP]', '[PAD]']: # Assuming 0 is 'O'
                label = self.model.config.id2label[pred.item()]
                entities.append({
                    "text": token.replace("##", ""),
                    "label": label,
                    "start": i, # approximate
                    "end": i+1,
                    "confidence": 0.95 # Mock confidence
                })
                
        return entities
