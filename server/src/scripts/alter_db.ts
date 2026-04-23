import prisma from '../lib/prisma';

async function main() {
  try {
    const res: any = await prisma.$queryRaw`SELECT atttypmod FROM pg_attribute WHERE attrelid = '"Memory"'::regclass AND attname = 'embedding'`;
    console.log("Current dimension (atttypmod):", res);
    
    // Drop and recreate to match vector(3072)
    await prisma.$executeRaw`ALTER TABLE "Memory" DROP COLUMN IF EXISTS "embedding"`;
    await prisma.$executeRaw`ALTER TABLE "Memory" ADD COLUMN "embedding" vector(3072)`;
    console.log("Successfully altered column to vector(3072)");
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
