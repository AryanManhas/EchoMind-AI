import { createLogger } from '../utils/logger.js';
import prisma from '../db/prisma.js';
import { embeddingService, EmbeddingService } from '../ai/embedding.service.js';
import { detectLanguage } from '../nlp/language.service.js';
import type { MemoryExtraction } from '@echomind/types';

const log = createLogger('memory-service');

interface LocalMemory {
  id: string;
  userId: string;
  title: string;
  summary: string;
  category: string;
  importance: number;
  sourceType: string;
  language: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  deletedAt?: Date;
  segments: Array<{ speakerId: string; text: string; startTime: number; endTime: number }>;
  reminders: unknown[];
}

const localMemories: LocalMemory[] = [];

/**
 * Core memory service — CRUD operations and embedding generation.
 */
export class MemoryService {
  /**
   * Save an extracted memory from the AI pipeline.
   * 1. Detect language
   * 2. Create the memory record
   * 3. Generate embedding asynchronously (or via BullMQ queue)
   */
  async saveFromExtraction(
    userId: string,
    extraction: MemoryExtraction,
    segments: Array<{ speakerId: string; text: string; startTime: number; endTime: number }> = [],
    sourceType: 'voice' | 'text' | 'import' | 'meeting' = 'voice',
    metadata: any = {}
  ) {
    if ((global as any).__dbFallback) {
      const memory = {
        id: Math.random().toString(36).substring(7),
        userId,
        title: extraction.title,
        summary: extraction.summary,
        category: extraction.category,
        importance: extraction.importance,
        sourceType,
        language: 'en',
        tags: extraction.tags || [],
        metadata,
        createdAt: new Date(),
        segments,
        reminders: []
      };
      localMemories.push(memory);
      return memory;
    }
    let nextActionDate: Date | null = null;
    if (extraction.category === 'Task') {
      nextActionDate = new Date();
      nextActionDate.setHours(nextActionDate.getHours() + 24);
    }

    // Combine segment text for language detection if available, else use title
    const combinedText = segments.length > 0 ? segments.map((s: { text: string }) => s.text).join(' ') : extraction.title;
    const langResult = detectLanguage(combinedText);

    // 1. Save memory without embedding
    const memory = await prisma.memory.create({
      data: {
        userId,
        title: extraction.title,
        summary: extraction.summary,
        category: extraction.category,
        importance: extraction.importance,
        sourceType,
        language: langResult.language,
        tags: extraction.tags || [],
        metadata,
        nextActionDate,
        segments: {
          createMany: {
            data: segments
          }
        }
      },
      include: {
        segments: true
      }
    });

    // 2. Generate and store embedding (non-blocking for the caller)
    // NOTE: When BullMQ is active, the WebSocket handler enqueues this instead.
    this.generateAndStoreEmbedding(memory.id, extraction.title, extraction.summary)
      .catch((err) => log.error({ err, memoryId: memory.id }, 'Background embedding failed'));

    return memory;
  }

  /**
   * Get all memories for a user with optional filtering.
   */
  async getMemories(
    userId: string,
    options?: { category?: string; limit?: number; offset?: number },
  ) {
    if ((global as any).__dbFallback) {
      let filtered = localMemories.filter((m: LocalMemory) => m.userId === userId && !m.deletedAt);
      if (options?.category && options.category !== 'All') {
        filtered = filtered.filter((m: LocalMemory) => m.category === options.category);
      }
      return filtered.sort((a: LocalMemory, b: LocalMemory) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    const where: any = { userId, deletedAt: null };
    if (options?.category && options.category !== 'All') {
      where.category = options.category;
    }

    return prisma.memory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
      include: { 
        reminders: true,
        segments: true
      },
    });
  }

  /**
   * Get a single memory by ID (with ownership check).
   */
  async getById(userId: string, memoryId: string) {
    if ((global as any).__dbFallback) {
      return localMemories.find((m: LocalMemory) => m.id === memoryId && m.userId === userId && !m.deletedAt) || null;
    }
    return prisma.memory.findFirst({
      where: { id: memoryId, userId, deletedAt: null },
      include: { 
        reminders: true,
        segments: true
      },
    });
  }

  /**
   * Soft delete a memory.
   */
  async softDelete(userId: string, memoryId: string) {
    if ((global as any).__dbFallback) {
      const memory = localMemories.find((m: LocalMemory) => m.id === memoryId && m.userId === userId);
      if (memory) memory.deletedAt = new Date();
      return { count: memory ? 1 : 0 };
    }
    return prisma.memory.updateMany({
      where: { id: memoryId, userId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Re-extract memory from stored transcript.
   */
  async retryExtraction(userId: string, memoryId: string, extractFn: (text: string) => Promise<MemoryExtraction | null>) {
    if ((global as any).__dbFallback) return null;
    const memory = await prisma.memory.findFirst({
      where: { id: memoryId, userId, deletedAt: null },
      include: { segments: true }
    });

    if (!memory || (!memory.segments || memory.segments.length === 0)) return null;

    const combinedText = memory.segments.map((s: { text: string }) => s.text).join(' ');
    const extraction = await extractFn(combinedText);
    if (!extraction) return null;

    const updated = await prisma.memory.update({
      where: { id: memory.id },
      data: {
        title: extraction.title,
        summary: extraction.summary,
        category: extraction.category,
        importance: extraction.importance,
        tags: extraction.tags || [],
      },
    });

    // Re-generate embedding with updated title/summary
    this.generateAndStoreEmbedding(memory.id, extraction.title, extraction.summary)
      .catch((err) => log.error({ err, memoryId: memory.id }, 'Retry embedding failed'));

    return updated;
  }

  // ─── Private ────────────────────────────────────────────────

  private async generateAndStoreEmbedding(memoryId: string, title: string, summary: string) {
    const textToEmbed = `Title: ${title}\nSummary: ${summary}`;
    const embedding = await embeddingService.generate(textToEmbed);
    const vec = EmbeddingService.toSqlVector(embedding);

    await prisma.$executeRaw`
      UPDATE "Memory" SET embedding = ${vec}::vector WHERE id = ${memoryId}
    `;

    log.info({ memoryId }, 'Embedding stored');
  }
}

export const memoryService = new MemoryService();
