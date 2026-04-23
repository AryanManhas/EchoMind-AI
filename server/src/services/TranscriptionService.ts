import { Readable } from 'stream';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../utils/env';

const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);

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
        correlationId: string,
        model: string = 'gemini-2.5-flash'
    ): Promise<TranscriptionResult> {
        console.log(`[TranscriptionService] [${correlationId}] Sending ${audioBuffer.length} bytes to Gemini for transcription...`);
        try {
            const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            
            const prompt = "Please transcribe this audio exactly as spoken. Return ONLY the transcribed text. Do not add any formatting, quotes, or commentary.";
            
            const audioPart = {
                inlineData: {
                    data: audioBuffer.toString('base64'),
                    mimeType: 'audio/wav'
                }
            };
            
            const result = await geminiModel.generateContent([prompt, audioPart]);
            const text = result.response.text().trim();
            
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
