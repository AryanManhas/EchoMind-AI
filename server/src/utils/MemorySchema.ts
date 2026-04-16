import { z } from 'zod';

export const MemoryCategoryEnum = z.enum(['Task', 'Fact', 'Idea']);

export const MemoryExtractionSchema = z.object({
  title: z.string().min(1, "Title is required").describe("A concise, declarative title."),
  summary: z.string().min(1, "Summary is required").describe("A concise, present-tense, actionable summary in Second Brain style."),
  category: MemoryCategoryEnum.describe("Must be exactly 'Task', 'Fact', or 'Idea'."),
  importance: z.number().min(0).max(1).describe("Importance score from 0.0 to 1.0.")
});

export type MemoryExtraction = z.infer<typeof MemoryExtractionSchema>;
