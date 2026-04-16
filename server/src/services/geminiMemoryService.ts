import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ 
  apiKey: process.env.GOOGLE_API_KEY 
});

const SYSTEM_INSTRUCTIONS = `You are a high-speed memory sorting engine. Analyze the provided transcript.
If the content is a task, a factual piece of information, or a creative idea, output a JSON object.
If the content is small talk, incomplete, or noise, output NULL.
JSON Schema: { "title": "string", "summary": "string", "category": "Task|Fact|Idea", "importance": 0.0-1.0 }`;

export async function sortMemory(transcript: string) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: transcript,
      config: {
        systemInstruction: SYSTEM_INSTRUCTIONS,
        responseMimeType: 'application/json',
      }
    });

    const outputText = response.text?.trim();
    if (!outputText || outputText === 'NULL') {
      return null;
    }

    return JSON.parse(outputText);
  } catch (error) {
    console.error('Error in sortMemory:', error);
    return null;
  }
}
