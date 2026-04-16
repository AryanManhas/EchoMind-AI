import prisma from '../lib/prisma';

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

    return await prisma.memory.create({
      data: {
        title: data.title,
        summary: data.summary,
        category: data.category,
        importance: data.importance,
        rawTranscript,
        nextActionDate,
      },
    });
  }
}
