export type TransportState =
  | 'discovering'
  | 'connecting'
  | 'connected'
  | 'local_ready'
  | 'cloud_ready'
  | 'offline_ready'
  | 'degraded'
  | 'reconnecting';

export interface BackendCapabilities {
  semanticMemory: boolean;
  proactiveAssistant: boolean;
  meetingIntelligence: boolean;
}

export interface ConnectionMetadata {
  apiUrl: string;
  wsUrl: string;
  runtime: 'local' | 'cloud' | 'hybrid';
  version: string;
  features: BackendCapabilities;
  lastConnected: number;
  confidenceScore?: number;
}

