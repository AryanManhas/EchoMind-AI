import { GoogleGenAI } from '@google/genai';
import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { CONSTANTS } from '../config/constants.js';

const log = createLogger('embedding');

const ai = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });

/**
 * Embedding service using Gemini embedding-001.
 * Generates 3072-dimensional vectors for semantic search.
 */
export class EmbeddingService {
  /**
   * Generate embedding for a single text.
   */
  async generate(text: string): Promise<number[]> {
    try {
      const response = await ai.models.embedContent({
        model: CONSTANTS.EMBEDDING_MODEL,
        contents: text,
      });

      if (!response.embeddings?.[0]?.values) {
        throw new Error('No embedding returned from API');
      }

      return response.embeddings[0].values;
    } catch (error) {
      log.error({ error, textLength: text.length }, 'Failed to generate embedding');
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in batch.
   */
  async generateBatch(texts: string[]): Promise<number[][]> {
    // Process sequentially to avoid rate limits
    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await this.generate(text);
      embeddings.push(embedding);
    }
    return embeddings;
  }

  /**
   * Format embedding array for pgvector SQL insertion.
   */
  static toSqlVector(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}

export const embeddingService = new EmbeddingService();
