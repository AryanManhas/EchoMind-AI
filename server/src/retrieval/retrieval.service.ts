import { createLogger } from '../utils/logger.js';
import prisma from '../db/prisma.js';
import { embeddingService, EmbeddingService } from '../ai/embedding.service.js';
import { CONSTANTS } from '../config/constants.js';
import { rankMemories, type RankableMemory, type RankedMemory, type RankingWeights } from './ranking.engine.js';
import type { MemorySearchResult } from '@echomind/types';

const log = createLogger('retrieval');

/**
 * Retrieval service — vector, keyword, and hybrid search with multi-signal ranking.
 *
 * Pipeline:
 * 1. Generate query embedding
 * 2. Run semantic search (pgvector cosine)
 * 3. Run keyword search (PostgreSQL full-text)
 * 4. Merge and deduplicate results
 * 5. Enrich with reminder/follow-up metadata
 * 6. Apply multi-signal ranking (semantic + keyword + recency + importance + reminder + follow-up)
 * 7. Return top N ranked results
 */
export class RetrievalService {
  /**
   * Semantic vector search using pgvector cosine similarity.
   */
  async semanticSearch(
    userId: string,
    query: string,
    limit: number = 10,
  ): Promise<MemorySearchResult[]> {
    try {
      const queryEmbedding = await embeddingService.generate(query);
      const vec = EmbeddingService.toSqlVector(queryEmbedding);

      const results = await prisma.$queryRaw<MemorySearchResult[]>`
        SELECT
          id, "userId", title, summary, category, importance,
          "sourceType", language, tags, "nextActionDate",
          "createdAt", "deletedAt",
          (SELECT json_agg(s.*) FROM "TranscriptSegment" s WHERE s."memoryId" = m.id) as segments,
          1 - (embedding <=> ${vec}::vector) as similarity
        FROM "Memory" m
        WHERE embedding IS NOT NULL
          AND "userId" = ${userId}
          AND "deletedAt" IS NULL
          AND 1 - (embedding <=> ${vec}::vector) >= ${CONSTANTS.SIMILARITY_THRESHOLD}
        ORDER BY embedding <=> ${vec}::vector ASC
        LIMIT ${limit}
      `;

      log.info({ userId, query: query.substring(0, 50), results: results.length }, 'Semantic search successful');
      return results;
    } catch (err) {
      log.error({ userId, err, query: query.substring(0, 50) }, 'Semantic search failed');
      throw err;
    }
  }

  /**
   * Full-text keyword search using PostgreSQL tsvector.
   * Supports bilingual queries — searches title, summary, transcript, and tags.
   */
  async keywordSearch(
    userId: string,
    query: string,
    limit: number = 10,
    category?: string,
  ): Promise<any[]> {
    const searchStr = query.trim().split(/\s+/).join(' | ');
    const whereClause: any = {
      userId,
      deletedAt: null,
      OR: [
        { summary: { search: searchStr } },
        { segments: { some: { text: { search: searchStr } } } },
        { title: { contains: query.trim(), mode: 'insensitive' } },
        { tags: { hasSome: query.trim().toLowerCase().split(/\s+/) } },
      ],
    };

    if (category && category !== 'All') {
      whereClause.category = category;
    }

    const results = await prisma.memory.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { 
        reminders: { where: { status: { not: 'completed' } }, take: 1 },
        segments: true 
      },
    });

    log.info({ userId, query: query.substring(0, 50), results: results.length }, 'Keyword search');
    return results;
  }

  /**
   * Advanced hybrid search with multi-signal ranking.
   *
   * Combines semantic + keyword results, enriches with reminder metadata,
   * and applies the 6-signal ranking engine for optimal result ordering.
   */
  async hybridSearch(
    userId: string,
    query: string,
    limit: number = CONSTANTS.RANKING_DEFAULT_LIMIT,
    category?: string,
    customWeights?: Partial<RankingWeights>,
  ): Promise<RankedMemory[]> {
    // 1. Run both searches in parallel
    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch(userId, query, limit * 2),
      this.keywordSearch(userId, query, limit * 2, category),
    ]);

    // 2. Merge and deduplicate
    const memoryMap = new Map<string, RankableMemory>();

    semanticResults.forEach((mem, idx) => {
      memoryMap.set(mem.id, {
        ...mem,
        similarity: (mem as any).similarity ?? 0,
        keywordRank: undefined,
        createdAt: mem.createdAt,
      });
    });

    keywordResults.forEach((mem, idx) => {
      const existing = memoryMap.get(mem.id);
      if (existing) {
        // Already in semantic results — add keyword rank
        existing.keywordRank = idx;
        // Enrich with reminder data if keyword search included it
        if (mem.reminders?.[0]) {
          existing.reminderStatus = mem.reminders[0].status;
          existing.reminderDueAt = mem.reminders[0].dueAt;
          existing.reminderPriority = mem.reminders[0].priority;
        }
      } else {
        const rankable: RankableMemory = {
          ...mem,
          similarity: 0, // Not found in semantic search
          keywordRank: idx,
          createdAt: mem.createdAt,
        };
        if (mem.reminders?.[0]) {
          rankable.reminderStatus = mem.reminders[0].status;
          rankable.reminderDueAt = mem.reminders[0].dueAt;
          rankable.reminderPriority = mem.reminders[0].priority;
        }
        memoryMap.set(mem.id, rankable);
      }
    });

    // 3. Apply multi-signal ranking
    const candidates = Array.from(memoryMap.values());
    const ranked = rankMemories(candidates, customWeights as RankingWeights, limit);

    log.info({
      userId,
      query: query.substring(0, 50),
      semanticCount: semanticResults.length,
      keywordCount: keywordResults.length,
      rankedCount: ranked.length,
      topScore: ranked[0]?.compositeScore?.toFixed(3),
    }, 'Hybrid search with multi-signal ranking');

    return ranked;
  }
}

export const retrievalService = new RetrievalService();
