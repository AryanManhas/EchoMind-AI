import prisma from '../lib/prisma';
import { vectorService } from '../services/vector.service';
import { logger } from '../utils/logger';

async function main() {
  logger.info('Starting backfill of vector embeddings for existing memories...');

  try {
    // Note: Since 'embedding' is an Unsupported("vector(768)") type, Prisma doesn't directly
    // let us query for `embedding: null` in the normal findMany type-safely in all versions.
    // However, we can use a raw query to fetch the IDs of memories that need backfilling.
    const memoriesWithoutEmbeddings: { id: string, title: string, summary: string }[] = await prisma.$queryRaw`
      SELECT id, title, summary
      FROM "Memory"
      WHERE embedding IS NULL
    `;

    if (memoriesWithoutEmbeddings.length === 0) {
      logger.info('No memories found that require backfilling.');
      return;
    }

    logger.info(`Found ${memoriesWithoutEmbeddings.length} memories to backfill. Processing...`);

    let successCount = 0;
    let errorCount = 0;

    for (const memory of memoriesWithoutEmbeddings) {
      try {
        const textToEmbed = `Title: ${memory.title}\nSummary: ${memory.summary}`;
        const embedding = await vectorService.generateEmbedding(textToEmbed);
        
        const embeddingString = `[${embedding.join(',')}]`;
        await prisma.$executeRaw`UPDATE "Memory" SET embedding = ${embeddingString}::vector WHERE id = ${memory.id}`;
        
        successCount++;
        logger.info(`Successfully backfilled memory ID: ${memory.id}`);
      } catch (error) {
        errorCount++;
        logger.error({ error, memoryId: memory.id }, `Failed to backfill memory ID: ${memory.id}`);
      }
    }

    logger.info(`Backfill complete. Success: ${successCount}, Errors: ${errorCount}`);
  } catch (error) {
    logger.error({ error }, 'Fatal error during backfill process');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
