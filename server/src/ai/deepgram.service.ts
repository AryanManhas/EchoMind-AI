import { DeepgramClient } from '@deepgram/sdk';
import fs from 'fs';
import { env } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('deepgram-service');

export interface DeepgramSegment {
  speakerId: string;
  text: string;
  startTime: number;
  endTime: number;
}

export class DeepgramService {
  private client: DeepgramClient;

  constructor() {
    if (!env.DEEPGRAM_API_KEY) {
      log.error('DEEPGRAM_API_KEY is missing from environment');
      throw new Error('Deepgram API Key is required');
    }
    this.client = new DeepgramClient({ apiKey: env.DEEPGRAM_API_KEY });
  }

  /**
   * Transcribe a local audio file with speaker diarization.
   * @param filePath Path to the local audio file.
   * @returns Array of speaker-labeled segments.
   */
  async transcribeFile(filePath: string, language: string = 'en'): Promise<DeepgramSegment[]> {
    try {
      log.info({ filePath, language }, 'Starting diarized transcription with Deepgram Nova-2');

      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const audioBuffer = fs.readFileSync(filePath);
      
      // In SDK v5, we use the v1.media path as identified during discovery.
      // The return type is typically { result, error }.
      const response = await (this.client.listen.v1.media as any).transcribeFile(
        audioBuffer,
        {
          model: 'nova-2',
          language,
          smart_format: true,
          diarize: true,
          utterances: true,
          punctuate: true,
        }
      );

      const { result, error } = response;

      if (error) {
        log.error({ error, filePath }, 'Deepgram API returned an error');
        throw new Error(`Deepgram transcription failed: ${error.message || JSON.stringify(error)}`);
      }

      if (!result) {
        log.error({ responseKeys: Object.keys(response) }, 'Deepgram response missing both result and error');
        throw new Error('Invalid Deepgram response structure');
      }
      
      log.info({ 
        model: result.metadata?.model_info?.name || 'nova-2',
        duration: result.metadata?.duration,
        requestId: result.metadata?.request_id,
        hasUtterances: !!result.results?.utterances 
      }, 'Deepgram response received successfully');

      // Extract utterances which contain speaker and timing info
      const utterances = result.results?.utterances || [];
      
      const segments: DeepgramSegment[] = utterances.map((u: any) => ({
        speakerId: u.speaker !== undefined ? `Speaker ${u.speaker}` : 'Unknown Speaker',
        text: u.transcript || u.text || '',
        startTime: u.start || 0,
        endTime: u.end || 0,
      }));

      if (segments.length === 0 && result.results?.channels?.[0]?.alternatives?.[0]?.transcript) {
        log.warn('No utterances found, falling back to full transcript without diarization');
        const fallbackText = result.results.channels[0].alternatives[0].transcript;
        segments.push({
          speakerId: 'Speaker 0',
          text: fallbackText,
          startTime: 0,
          endTime: result.metadata?.duration || 0
        });
      }

      log.info({ segmentCount: segments.length }, 'Diarized transcription processing complete');
      return segments;
    } catch (err) {
      log.error({ err, filePath }, 'Deepgram transcription service error');
      throw err;
    }
  }
}

export const deepgramService = new DeepgramService();
