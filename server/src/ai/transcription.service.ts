import { Readable } from 'stream';
import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { CONSTANTS } from '../config/constants.js';

const ai = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });

export interface TranscriptionResult {
    text: string;
    language?: string;
    duration?: number;
}

export class TranscriptionService {
    
    async transcribeStream(
        audioStream: Readable,
        correlationId: string
    ): Promise<TranscriptionResult> {
        console.log(`[TranscriptionService] [${correlationId}] Collecting audio stream for Gemini transcription...`);
        const chunks: Buffer[] = [];
        for await (const chunk of audioStream) {
            chunks.push(Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);
        return this.transcribeBuffer(buffer, correlationId);
    }

    async transcribeBuffer(
        audioBuffer: Buffer,
        correlationId: string
    ): Promise<TranscriptionResult> {
        console.log(`[TranscriptionService] [${correlationId}] Sending ${audioBuffer.length} bytes to Gemini for transcription...`);
        try {
            const prompt = "Please transcribe this audio exactly as spoken. Return ONLY the transcribed text. Do not add any formatting, quotes, or commentary.";
            
            const response = await ai.models.generateContent({
                model: CONSTANTS.GEMINI_MODEL,
                contents: [
                    {
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    data: audioBuffer.toString('base64'),
                                    mimeType: 'audio/wav'
                                }
                            }
                        ]
                    }
                ]
            });
            
            const text = response.text?.trim() || '';
            if (!text) {
                throw new Error('Gemini returned empty transcription');
            }
            
            console.log(`[TranscriptionService] [${correlationId}] Transcription successful: "${text.substring(0, 50)}..."`);
            return { text };
        } catch (error) {
            console.error(`[TranscriptionService] [${correlationId}] Gemini transcription failed:`, error);
            
            // Fallback for demo mode
            if (env.DEMO_MODE) {
                console.warn(`[TranscriptionService] [${correlationId}] Falling back to DEMO_MODE mock transcription.`);
                return { text: "This is a mock transcription because the Gemini API request failed in demo mode." };
            }
            throw error;
        }
    }
}
