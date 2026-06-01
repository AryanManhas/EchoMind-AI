// Socket message type definitions for EchoMind mobile client

export type SocketMessage =
  | AuthMessage
  | AuthOkMessage
  | AuthFailMessage
  | TextTranscriptMessage
  | QueryMessage
  | GenericMessage;

export interface BaseMessage {
  type: string;
  [key: string]: any;
}

export interface AuthMessage extends BaseMessage {
  type: 'AUTH';
  token: string;
}

export interface AuthOkMessage extends BaseMessage {
  type: 'AUTH_OK';
  userId?: string;
}

export interface AuthFailMessage extends BaseMessage {
  type: 'AUTH_FAIL';
  reason?: string;
}

export interface TextTranscriptMessage extends BaseMessage {
  type: 'TEXT_TRANSCRIPT';
  text: string;
}

export interface QueryMessage extends BaseMessage {
  type: 'QUERY';
  text: string;
}

export interface GenericMessage extends BaseMessage {
  // Any other server-defined message types will extend this shape
}
