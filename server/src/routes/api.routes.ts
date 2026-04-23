import { Router } from 'express';
import { MemoryController } from '../controllers/MemoryController';

const router = Router();
const memoryController = new MemoryController();

router.get('/memories', memoryController.getMemories);
router.get('/memories/semantic-search', memoryController.semanticSearch);
router.post('/memories/:id/retry', memoryController.retryExtraction);

export default router;
