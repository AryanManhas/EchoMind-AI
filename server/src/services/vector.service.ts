import { GoogleGenAI } from '@google/genai';
import { logger } from '../utils/logger';

const ai = new GoogleGenAI({ 
  apiKey: process.env.GOOGLE_API_KEY 
});

export class VectorService {
  /**
   * Generates a 768-dimensional embedding vector for the provided text.
   * @param text The text to embed
   * @returns Array of 768 floats representing the embedding
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: text,
      });

      if (!response.embeddings || response.embeddings.length === 0 || !response.embeddings[0].values) {
        throw new Error('No embedding returned from Gemini API');
      }

      return response.embeddings[0].values;
    } catch (error) {
      logger.error({ error }, 'Failed to generate embedding');
      throw error;
    }
  }
}

export const vectorService = new VectorService();
