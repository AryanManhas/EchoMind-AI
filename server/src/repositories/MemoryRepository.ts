import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { vectorService } from '../services/vector.service';
import { logger } from '../utils/logger';

export class MemoryRepository {
  async saveExtractedMemory(
    data: {
      title: string;
      summary: string;
      category: string;
      importance: number;
    },
    rawTranscript: string
  ) {
    let nextActionDate: Date | null = null;
    if (data.category === 'Task') {
      nextActionDate = new Date();
      nextActionDate.setHours(nextActionDate.getHours() + 24);
    }

    // 1. Save memory without embedding first
    const memory = await prisma.memory.create({
      data: {
        title: data.title,
        summary: data.summary,
        category: data.category,
        importance: data.importance,
        rawTranscript,
        nextActionDate,
      },
    });

    // 2. Generate embedding for title + summary
    try {
      const textToEmbed = `Title: ${data.title}\nSummary: ${data.summary}`;
      const embedding = await vectorService.generateEmbedding(textToEmbed);
      
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
      const queryEmbedding = await vectorService.generateEmbedding(queryText);
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
          "rawTranscript", 
          "createdAt",
          1 - (embedding <=> ${embeddingString}::vector) as similarity
        FROM "Memory"
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

