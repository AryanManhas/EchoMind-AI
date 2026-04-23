import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function sortMemory(transcript: string) {
    if (!process.env.GEMINI_API_KEY) {
        console.warn("GEMINI_API_KEY is missing.");
        return null;
    }

    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: "You are the EchoMind Sorting Engine. Analyze the following transcript. If it contains a long-term fact, task, or significant event, output a JSON object. If not, output NULL.\n\nOutput Schema: { \"title\": \"string\", \"summary\": \"string\", \"category\": \"Task|Fact|Idea\", \"importance\": 0.0-1.0 }",
    });

    try {
        const result = await model.generateContent(transcript);
        const text = result.response.text().trim();

        if (text === 'NULL' || text === 'null' || text === '') {
            return null;
        }

        const jsonMatch = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || [null, text];
        const jsonString = jsonMatch[1].trim();

        const memoryAnalysis = JSON.parse(jsonString);
        return memoryAnalysis;
    } catch (err) {
        console.error("Gemini memory sorting error:", err);
        return null;
    }
}
