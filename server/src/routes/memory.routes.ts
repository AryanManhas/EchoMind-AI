import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';
import { memoryController } from '../controllers/MemoryController.js';
import { CreateMemorySchema, SearchMemorySchema } from '@echomind/types';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { extractMemory } from '../ai/gemini.service.js';
import { memoryService } from '../services/memory.service.js';
import { ReminderService } from '../reminders/reminder.service.js';
import { ReminderExtractionSchema } from '@echomind/types';
import type { ApiResponse } from '@echomind/types';

const router = Router();

// ─── Multer Config ──────────────────────────────────────────
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.wav', '.m4a', '.mp3', '.webm', '.aac', '.ogg'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Supported: .wav, .m4a, .mp3, .webm, .aac, .ogg'));
    }
  }
});

// ─── Routes ──────────────────────────────────────────────────

// List memories
router.get('/', requireAuth, memoryController.getMemories);

// Search memories (Semantic/Keyword/Hybrid)
router.get('/search', requireAuth, validate(SearchMemorySchema, 'query'), memoryController.search);

// Get single memory
router.get('/:id', requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const memory = await memoryService.getById(userId, req.params.id as string);
  if (!memory) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Memory not found' } });
  }
  res.json({ success: true, data: memory });
});

// Create manual text memory
router.post('/', requireAuth, validate(CreateMemorySchema), async (req, res) => {
  const userId = req.user!.userId;
  const { text, sourceType } = req.body;

  const extraction = await extractMemory(text);
  if (!extraction) {
    return res.status(422).json({
      success: false,
      error: { code: 'AI_PROCESSING_FAILED', message: 'Could not extract memory from text' },
    });
  }

  const memory = await memoryService.saveFromExtraction(
    userId, 
    extraction, 
    [{ speakerId: 'User', text, startTime: 0, endTime: 0 }], 
    sourceType
  );

  // Create reminder if extracted
  let reminder = null;
  if (extraction.reminders) {
    const reminderParsed = ReminderExtractionSchema.safeParse(extraction.reminders);
    if (reminderParsed.success) {
      reminder = await ReminderService.createReminder(userId, memory.id, reminderParsed.data);
    }
  }

  const response: ApiResponse = { success: true, data: { memory, reminder } };
  res.status(201).json(response);
});

// Upload audio for processing
router.post('/upload', requireAuth, upload.single('audio'), memoryController.uploadAudio);

// Retry extraction
router.post('/:id/retry', requireAuth, memoryController.retryExtraction);

// Delete memory
router.delete('/:id', requireAuth, memoryController.deleteMemory);

export default router;
