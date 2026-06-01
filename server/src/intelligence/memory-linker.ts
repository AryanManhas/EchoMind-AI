import { createLogger } from '../utils/logger.js';
import prisma from '../db/prisma.js';
import { embeddingService, EmbeddingService } from '../ai/embedding.service.js';

const log = createLogger('memory-linker');

/**
 * Contextual Memory Linking Engine
 *
 * After a memory is saved, this engine finds and creates links to:
 * 1. Semantically related memories (via embedding similarity)
 * 2. People-based connections (shared entity references)
 * 3. Temporal proximity (memories within the same time window)
 * 4. Follow-up chains (task → follow-up → completion)
 * 5. Recurring patterns (repeated topics or tasks)
 *
 * Links are stored in-memory per session and as tags in the database
 * for lightweight relational retrieval without a separate join table.
 */

export interface MemoryLink {
  sourceId: string;
  targetId: string;
  linkType: 'semantic' | 'entity' | 'temporal' | 'follow_up' | 'recurring';
  strength: number; // 0-1
  reason: string;
}

interface LinkableMemory {
  id: string;
  title: string;
  summary: string;
  category?: string;
  tags: string[];
  createdAt: Date;
}

export class MemoryLinker {
  /**
   * Find related memories for a newly saved memory.
   * Returns links ordered by strength.
   */
  static async findRelatedMemories(
    userId: string,
    memoryId: string,
    options: {
      maxLinks?: number;
      minSimilarity?: number;
      temporalWindowHours?: number;
    } = {},
  ): Promise<MemoryLink[]> {
    const {
      maxLinks = 5,
      minSimilarity = 0.5,
      temporalWindowHours = 24,
    } = options;

    const memory = await prisma.memory.findFirst({
      where: { id: memoryId, userId, deletedAt: null },
    });

    if (!memory) {
      log.warn({ memoryId }, 'Memory not found for linking');
      return [];
    }

    const links: MemoryLink[] = [];

    // Run all linking strategies in parallel
    const [semanticLinks, entityLinks, temporalLinks] = await Promise.allSettled([
      this.findSemanticLinks(userId, memory, minSimilarity),
      this.findEntityLinks(userId, memory),
      this.findTemporalLinks(userId, memory, temporalWindowHours),
    ]);

    if (semanticLinks.status === 'fulfilled') links.push(...semanticLinks.value);
    if (entityLinks.status === 'fulfilled') links.push(...entityLinks.value);
    if (temporalLinks.status === 'fulfilled') links.push(...temporalLinks.value);

    // Deduplicate by targetId, keeping strongest link
    const dedupedMap = new Map<string, MemoryLink>();
    for (const link of links) {
      if (link.targetId === memoryId) continue; // Skip self-links

      const existing = dedupedMap.get(link.targetId);
      if (!existing || link.strength > existing.strength) {
        dedupedMap.set(link.targetId, link);
      }
    }

    const result = Array.from(dedupedMap.values())
      .sort((a, b) => b.strength - a.strength)
      .slice(0, maxLinks);

    log.info({
      memoryId,
      linksFound: result.length,
      types: result.map((l: MemoryLink) => l.linkType),
    }, 'Memory links computed');

    return result;
  }

  /**
   * Find follow-up chains: given a task memory, find its predecessors and successors.
   */
  static async findFollowUpChain(
    userId: string,
    memoryId: string,
  ): Promise<{ predecessors: string[]; successors: string[] }> {
    const memory = await prisma.memory.findFirst({
      where: { id: memoryId, userId, deletedAt: null },
    });

    if (!memory || memory.category !== 'Task') {
      return { predecessors: [], successors: [] };
    }

    // Find tasks with overlapping tags created before/after this memory
    const [predecessors, successors] = await Promise.all([
      prisma.memory.findMany({
        where: {
          userId,
          category: 'Task',
          deletedAt: null,
          createdAt: { lt: memory.createdAt },
          tags: { hasSome: memory.tags.slice(0, 3) },
          id: { not: memoryId },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
      prisma.memory.findMany({
        where: {
          userId,
          category: 'Task',
          deletedAt: null,
          createdAt: { gt: memory.createdAt },
          tags: { hasSome: memory.tags.slice(0, 3) },
          id: { not: memoryId },
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 3,
      }),
    ]);

    return {
      predecessors: predecessors.map((p: { id: string }) => p.id),
      successors: successors.map((s: { id: string }) => s.id),
    };
  }

  // ─── Private Strategies ─────────────────────────────────────

  /**
   * Strategy 1: Semantic similarity via pgvector.
   */
  private static async findSemanticLinks(
    userId: string,
    memory: LinkableMemory,
    minSimilarity: number,
  ): Promise<MemoryLink[]> {
    try {
      // Generate embedding for the memory's content
      const textToEmbed = `${memory.title} ${memory.summary}`;
      const embedding = await embeddingService.generate(textToEmbed);
      const vec = EmbeddingService.toSqlVector(embedding);

      const similar = await prisma.$queryRaw<Array<{ id: string; title: string; similarity: number }>>`
        SELECT id, title, 1 - (embedding <=> ${vec}::vector) as similarity
        FROM "Memory"
        WHERE embedding IS NOT NULL
          AND "userId" = ${userId}
          AND "deletedAt" IS NULL
          AND id != ${memory.id}
          AND 1 - (embedding <=> ${vec}::vector) >= ${minSimilarity}
        ORDER BY embedding <=> ${vec}::vector ASC
        LIMIT 5
      `;

      return similar.map((s: { id: string; title: string; similarity: number }) => ({
        sourceId: memory.id,
        targetId: s.id,
        linkType: 'semantic' as const,
        strength: s.similarity,
        reason: `Semantically similar to "${s.title}"`,
      }));
    } catch (err) {
      log.error({ err }, 'Semantic linking failed');
      return [];
    }
  }

  /**
   * Strategy 2: Shared entity references (people, locations).
   */
  private static async findEntityLinks(
    userId: string,
    memory: LinkableMemory,
  ): Promise<MemoryLink[]> {
    if (!memory.tags || memory.tags.length === 0) return [];

    // Find memories sharing at least 2 tags
    const related = await prisma.memory.findMany({
      where: {
        userId,
        deletedAt: null,
        id: { not: memory.id },
        tags: { hasSome: memory.tags },
      },
      select: { id: true, title: true, tags: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return related
      .map((r: { id: string; title: string; tags: string[] }) => {
        const sharedTags = memory.tags.filter((t: string) => r.tags.includes(t));
        const strength = Math.min(1, sharedTags.length / Math.max(memory.tags.length, 1));
        return {
          sourceId: memory.id,
          targetId: r.id,
          linkType: 'entity' as const,
          strength,
          reason: `Shared entities: ${sharedTags.join(', ')}`,
        };
      })
      .filter((l: MemoryLink) => l.strength >= 0.3);
  }

  /**
   * Strategy 3: Temporal proximity (same conversation window).
   */
  private static async findTemporalLinks(
    userId: string,
    memory: LinkableMemory,
    windowHours: number,
  ): Promise<MemoryLink[]> {
    const windowMs = windowHours * 60 * 60 * 1000;
    const start = new Date(memory.createdAt.getTime() - windowMs);
    const end = new Date(memory.createdAt.getTime() + windowMs);

    const nearby = await prisma.memory.findMany({
      where: {
        userId,
        deletedAt: null,
        id: { not: memory.id },
        createdAt: { gte: start, lte: end },
      },
      select: { id: true, title: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return nearby.map((n: { id: string; title: string; createdAt: Date }) => {
      const timeDiff = Math.abs(memory.createdAt.getTime() - n.createdAt.getTime());
      const strength = Math.max(0, 1 - timeDiff / windowMs);
      return {
        sourceId: memory.id,
        targetId: n.id,
        linkType: 'temporal' as const,
        strength,
        reason: `Created within ${Math.round(timeDiff / 60000)} minutes`,
      };
    });
  }
}
