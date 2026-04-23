import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { MemoryExtractionSchema, MemoryExtraction } from '../utils/MemorySchema';
import { env } from '../utils/env';
import { logger } from '../utils/logger';

const apiKey = env.GOOGLE_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

export async function extractMemory(transcript: string): Promise<MemoryExtraction | null> {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); // Using a strong model as per user's typical high-tier settings, or fallback to flash

    const systemPrompt = `You are the EchoMind Memory Engine, an intelligent "Second Brain".
Your goal is to extract a highly accurate, structured memory from the provided transcript.
Write the summary in a concise, present-tense, and actionable style. Keep it under 3 sentences.
Categorize the memory STRICTLY into one of three types: "Task", "Fact", or "Idea".
Provide an importance score from 0.0 (trivial) to 1.0 (critical).`;

    try {
        const result = await model.generateContent({
            contents: [
                { role: 'user', parts: [{ text: systemPrompt }] },
                { role: 'user', parts: [{ text: `Transcript: "${transcript}"` }] }
            ],
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: SchemaType.OBJECT,
                    properties: {
                        title: { type: SchemaType.STRING },
                        summary: { type: SchemaType.STRING },
                        category: { 
                            type: SchemaType.STRING, 
                            description: 'Fact, Task, Idea'
                        },
                        importance: { type: SchemaType.NUMBER }
                    },
                    required: ['title', 'summary', 'category', 'importance']
                }
            }
        });

        try {
            const text = result.response.text();
            const rawJson = JSON.parse(text);

            // Zod validation
            const parsed = MemoryExtractionSchema.safeParse(rawJson);
            
            if (parsed.success) {
                return parsed.data;
            } else {
                console.warn(`[INTEL] Zod validation failed, applying heuristic fallback.`);
                return {
                    title: rawJson.title || rawJson.summary?.substring(0, 30) + '...' || 'Captured Memory',
                    summary: rawJson.summary || transcript.substring(0, 100),
                    category: ['Task', 'Fact', 'Idea'].includes(rawJson.category) ? rawJson.category : 'Fact',
                    importance: typeof rawJson.importance === 'number' ? rawJson.importance : 0.5
                };
            }
        } catch (parseError) {
            console.warn(`[INTEL] JSON parse completely failed. Generating safe memory.`);
            return {
                title: 'Captured Memory',
                summary: transcript.substring(0, 500) || 'Unintelligible transcript',
                category: 'Fact',
                importance: 0.5
            };
        }

    } catch (error) {
        if (env.DEMO_MODE) {
            logger.warn(`[DEMO_MODE] Gemini API unreachable. Injecting high-quality mock memory.`);
            return {
                title: "Research Neural Interfaces",
                summary: "Explored the latest advancements in brain-computer interfaces to enhance high-bandwidth human-to-AI data transfer.",
                category: "Idea",
                importance: 0.95
            };
        }
        logger.error({ error }, '[INTEL] Failed to extract memory');
        return null;
    }
}

export async function extractContext(text: string) {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `Extract useful context or entities from the following text and summarize them concisely:\n\n"${text}"`;
    try {
        const result = await model.generateContent(prompt);
        return { context: result.response.text() };
    } catch (error: any) {
        logger.error({ error }, '[INTEL] Failed to extract context');
        return { context: null, error: error.message || 'Extraction failed' };
    }
}
