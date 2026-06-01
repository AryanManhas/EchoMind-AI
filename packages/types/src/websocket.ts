// ─── WebSocket Protocol ───────────────────────────────────────
// All WebSocket messages MUST conform to this protocol.
// Version field enables backward-compatible protocol evolution.
// ────────────────────────────────────────────────────────────────

export const WS_PROTOCOL_VERSION = 1;

// ─── Client → Server Message Types ───────────────────────────
export type ClientMessageType =
  | 'AUTH'              // Send JWT token for authentication
  | 'PING'             // Keepalive ping
  | 'AUDIO_CHUNK'      // Raw audio data chunk
  | 'TEXT_TRANSCRIPT'   // Finalized text from mobile STT
  | 'STREAM_START'     // Begin audio stream session
  | 'STREAM_STOP';     // End audio stream session

// ─── Server → Client Message Types ───────────────────────────
export type ServerMessageType =
  | 'AUTH_OK'           // Authentication successful
  | 'AUTH_FAIL'        // Authentication failed
  | 'PONG'             // Keepalive response
  | 'STATUS_CHANGE'    // Pipeline status update
  | 'PARTIAL_TRANSCRIPT' // Streaming partial transcript
  | 'FINAL_TRANSCRIPT'   // Complete transcript
  | 'MEMORY_SAVED'      // Memory extraction complete
  | 'REMINDER_CREATED'  // Reminder extracted and saved
  | 'ERROR'            // Error message
  | 'HEARTBEAT';       // Server heartbeat

// ─── Base Message ─────────────────────────────────────────────
export interface WSMessage<T extends string = string> {
  type: T;
  version?: number;
  correlationId?: string;
  timestamp?: number;
}

// ─── Client Messages ──────────────────────────────────────────
export interface WSAuthMessage extends WSMessage<'AUTH'> {
  token: string;
}

export interface WSTextTranscript extends WSMessage<'TEXT_TRANSCRIPT'> {
  text: string;
  isFinal?: boolean;
  sessionId?: string;
}

export interface WSStreamControl extends WSMessage<'STREAM_START' | 'STREAM_STOP'> {
  sessionId?: string;
}

// ─── Server Messages ──────────────────────────────────────────
export interface WSStatusChange extends WSMessage<'STATUS_CHANGE'> {
  status: 'listening' | 'transcribing' | 'analyzing' | 'saving' | 'searching' | 'idle';
  language?: string;
}

export interface WSPartialTranscript extends WSMessage<'PARTIAL_TRANSCRIPT'> {
  text: string;
}

export interface WSFinalTranscript extends WSMessage<'FINAL_TRANSCRIPT'> {
  text: string;
}

export interface WSMemorySaved extends WSMessage<'MEMORY_SAVED'> {
  data: {
    id: string;
    title: string;
    summary: string;
    category: string;
    importance: number;
    language?: string;
    segments?: {
      id: string;
      text: string;
      speakerId: string;
      startTime: number;
      endTime: number;
    }[];
  };
  reminder?: {
    id: string;
    title: string;
    dueAt: string;
  } | null;
}

export interface WSError extends WSMessage<'ERROR'> {
  message: string;
  code?: string;
}
