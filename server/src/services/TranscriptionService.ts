import * as http from 'http';
import { Readable } from 'stream';
import { randomBytes } from 'crypto';

export interface TranscriptionResult {
    text: string;
    language?: string;
    duration?: number;
}

export class TranscriptionService {
    private readonly whisperUrl: string;
    private readonly whisperPort: number;

    constructor() {
        this.whisperUrl = process.env.WHISPER_URL || 'localhost';
        this.whisperPort = parseInt(process.env.WHISPER_PORT || '8000', 10);
    }

    async transcribeStream(
        audioStream: Readable,
        correlationId: string
    ): Promise<TranscriptionResult> {
        return new Promise((resolve, reject) => {
            const boundary = '----EchoMind' + randomBytes(8).toString('hex');
            const options: http.RequestOptions = {
                hostname: this.whisperUrl,
                port: this.whisperPort,
                path: '/v1/audio/transcriptions',
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'X-Correlation-ID': correlationId
                }
            };

            console.log(`[TranscriptionService] [${correlationId}] Initiating Whisper request to ${this.whisperUrl}:${this.whisperPort}`);

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(parsed);
                        } catch (e) {
                            reject(new Error(`Failed to parse Whisper response: ${data}`));
                        }
                    } else {
                        reject(new Error(`Whisper service error (${res.statusCode}): ${data}`));
                    }
                });
            });

            req.on('error', (err) => {
                console.error(`[TranscriptionService] [${correlationId}] Whisper Request Error:`, err);
                reject(err);
            });

            // Write multipart body
            req.write(`--${boundary}\r\n`);
            req.write(`Content-Disposition: form-data; name="model"\r\n\r\n`);
            req.write(`whisper-1\r\n`);
            req.write(`--${boundary}\r\n`);
            req.write(`Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n`);
            req.write(`Content-Type: application/octet-stream\r\n\r\n`);

            audioStream.on('data', (chunk) => req.write(chunk));
            audioStream.on('end', () => {
                req.write(`\r\n--${boundary}--\r\n`);
                req.end();
                console.log(`[TranscriptionService] [${correlationId}] Audio stream ended, finalized Whisper request.`);
            });

            audioStream.on('error', (err) => {
                req.destroy(err);
                reject(err);
            });
        });
    }

    async transcribeBuffer(
        audioBuffer: Buffer,
        correlationId: string,
        model: string = 'whisper-1'
    ): Promise<TranscriptionResult> {
        return new Promise((resolve, reject) => {
            const boundary = '----EchoMindPartial' + randomBytes(8).toString('hex');
            const options: http.RequestOptions = {
                hostname: this.whisperUrl,
                port: this.whisperPort,
                path: '/v1/audio/transcriptions',
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'X-Correlation-ID': correlationId
                }
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new Error(`Failed to parse partial response`));
                        }
                    } else {
                        reject(new Error(`Partial Whisper error (${res.statusCode})`));
                    }
                });
            });

            req.on('error', (err) => reject(err));

            // Write multipart body
            req.write(`--${boundary}\r\n`);
            req.write(`Content-Disposition: form-data; name="model"\r\n\r\n`);
            req.write(`${model}\r\n`);
            req.write(`--${boundary}\r\n`);
            req.write(`Content-Disposition: form-data; name="file"; filename="partial.wav"\r\n`);
            req.write(`Content-Type: application/octet-stream\r\n\r\n`);
            req.write(audioBuffer);
            req.write(`\r\n--${boundary}--\r\n`);
            req.end();
        });
    }
}
