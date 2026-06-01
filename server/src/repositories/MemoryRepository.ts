import prisma from '../lib/prisma.js';
import { embeddingService } from '../ai/embedding.service.js';
import { logger } from '../utils/logger.js';

export class MemoryRepository {
  async saveExtractedMemory(
    data: {
      title: string;
      summary: string;
      category: string;
      importance: number;
    },
    segments: Array<{ speakerId: string; text: string; startTime: number; endTime: number }>,
    userId: string
  ) {
    let nextActionDate: Date | null = null;
    if (data.category === 'Task') {
      nextActionDate = new Date();
      nextActionDate.setHours(nextActionDate.getHours() + 24);
    }

    // 1. Save memory without embedding first
    const memory = await prisma.memory.create({
      data: {
        userId,
        title: data.title,
        summary: data.summary,
        category: data.category,
        importance: data.importance,
        sourceType: 'voice',
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

    // 2. Generate embedding for title + summary
    try {
      const textToEmbed = `Title: ${data.title}\nSummary: ${data.summary}`;
      const embedding = await embeddingService.generate(textToEmbed);
      
      // 3. Update memory with embedding using raw SQL
      const embeddingString = `[${embedding.join(',')}]`;
      await prisma.$executeRaw`UPDATE "Memory" SET embedding = ${embeddingString}::vector WHERE id = ${memory.id}`;
      
    } catch (error) {
      logger.error({ error, memoryId: memory.id }, 'Failed to generate and save embedding for memory');
      // We don't fail the overall transaction if the embedding generation fails
    }

    return memory;
  }

  /**
   * Search for similar memories using pgvector cosine similarity.
   * @param queryText The semantic query to search for
   * @param limit Maximum number of results to return
   */
  async searchSimilarMemories(queryText: string, limit: number = 5) {
    try {
      // 1. Generate embedding for search query
      const queryEmbedding = await embeddingService.generate(queryText);
      const embeddingString = `[${queryEmbedding.join(',')}]`;

      // 2. Execute vector similarity search using Cosine distance (<=>)
      // Note: `1 - distance` gives similarity score.
      const results = await prisma.$queryRaw`
        SELECT 
          id, 
          title, 
          summary, 
          category, 
          importance, 
          "createdAt",
          (SELECT json_agg(s.*) FROM "TranscriptSegment" s WHERE s."memoryId" = m.id) as segments,
          1 - (embedding <=> ${embeddingString}::vector) as similarity
        FROM "Memory" m
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${embeddingString}::vector ASC
        LIMIT ${limit}
      `;

      return results;
    } catch (error) {
      logger.error({ error, queryText }, 'Failed to search similar memories');
      throw error;
    }
  }
}
