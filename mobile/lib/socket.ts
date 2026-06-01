// EchoMindSocket - production-grade WebSocket transport layer
// Refactored for stability, authentication safety, memory safety, and observability.

import { AppState, type AppStateStatus } from 'react-native';
import { TransportManager } from './transport/TransportManager';
import { ZodError, z } from 'zod';
import { ENV } from './env';

// ---------- Types & Schemas ----------

type Listener<T = unknown> = (data: T) => void;

enum SocketEvent {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  LOCAL_MODE = 'local_mode',
  SUSPENDED = 'suspended',
  AUTHENTICATING = 'authenticating',
  AUTH_FAILED = 'auth_failed',
  RECONNECTING = 'reconnecting',
  MESSAGE = 'message',
  PING = 'ping',
  PONG = 'pong',
}

enum SocketState {
  LOCAL_MODE = 'LOCAL_MODE',
  SUSPENDED = 'SUSPENDED',
  CONNECTING = 'CONNECTING',
  AUTHENTICATING = 'AUTHENTICATING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
}

// Server -> client messages
const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('AUTH_OK') }),
  z.object({ type: z.literal('AUTH_FAIL'), reason: z.string().optional(), message: z.string().optional() }),
  z.object({ type: z.literal('PING') }),
  z.object({ type: z.literal('PONG') }),
  z.object({ type: z.literal('MESSAGE'), payload: z.any() }),
  z.object({
    type: z.literal('STATUS_CHANGE'),
    status: z.string(),
    correlationId: z.string().optional(),
    language: z.string().optional()
  }),
  z.object({
    type: z.literal('MEMORY_SAVED'),
    data: z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      category: z.string(),
      importance: z.number(),
      language: z.string().optional(),
      segments: z.array(z.any()).optional(),
    }).optional(),
    reminder: z.object({
      id: z.string(),
      title: z.string(),
      dueAt: z.string(),
    }).nullable().optional(),
    correlationId: z.string().optional()
  }),
  z.object({
    type: z.literal('QUERY_RESULT'),
    query: z.string(),
    language: z.string().optional(),
    results: z.array(z.any()),
    aiAnswer: z.string(),
  }),
  z.object({
    type: z.literal('ERROR'),
    message: z.string(),
    code: z.string().optional(),
  }),
  z.object({
    type: z.literal('CALENDAR_EVENT_CREATED'),
    data: z.any(),
  }),
  z.object({
    type: z.literal('PARTIAL_TRANSCRIPT'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('FINAL_TRANSCRIPT'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('processing_memory')
  }),
]);

type ServerMessage = z.infer<typeof ServerMessageSchema>;

// Client -> server messages
const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('AUTH'), token: z.string() }),
  z.object({ type: z.literal('TEXT_TRANSCRIPT'), text: z.string(), correlationId: z.string().optional(), isFinal: z.boolean().optional(), sessionId: z.string().optional() }),
  z.object({ type: z.literal('QUERY'), text: z.string() }),
  z.object({ type: z.literal('PING') }),
  z.object({ type: z.literal('PONG') }),
]);

type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------- Configuration ----------
const MAX_QUEUE_SIZE = 100; // bounded outbound queue
const AUTH_TIMEOUT_MS = 10_000; // 10 seconds
const HEARTBEAT_INTERVAL_MS = 30_000; // ping every 30s
const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_JITTER_MS = 500; // ±500ms jitter
const RECONNECT_MAX_ATTEMPTS = 10;

// ---------- Helper ----------
function log(...args: any[]) {
  if (__DEV__) {
    console.log('[EchoMindSocket]', ...args);
  }
}

export class EchoMindSocket {
  // Singleton instance
  private static instance: EchoMindSocket;

  // WebSocket & URL
  private socket: WebSocket | null = null;
  private readonly url: string;

  // Auth token (JWT)
  private authToken: string | null = null;

  // Listeners (event -> Set of callbacks)
  private listeners: Map<SocketEvent | string, Set<Listener>> = new Map();

  // State machine
  private state: SocketState = SocketState.LOCAL_MODE;

  // Queue for outbound messages (bounded)
  private messageQueue: ClientMessage[] = [];
  private droppedMessageCount = 0;

  // Reconnect handling
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Auth timeout timer
  private authTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  // Heartbeat timer
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  // Metrics
  private metrics = {
    authLatencyMs: 0,
    reconnectCount: 0,
    queueLength: 0,
    droppedMessages: 0,
  };

  // AppState suspension
  private isSuspended = false;
  private appStateSubscription: { remove: () => void } | null = null;
  private appState: AppStateStatus = AppState.currentState;
  private reconnectScheduled = false;

  private constructor(url?: string) {
    this.url = url || '';
    this.setupAppStateListener();
  }

  // ---------- Public API ----------
  public static getInstance(): EchoMindSocket {
    if (!EchoMindSocket.instance) {
      EchoMindSocket.instance = new EchoMindSocket(TransportManager.getWsUrl() || ENV.WS_URL);
    }
    return EchoMindSocket.instance;
  }

  public setAuthToken(token: string) {
    this.authToken = token;
  }
  public getAuthToken(): string | null {
    return this.authToken;
  }

  public streamTranscript(text: string, sessionId?: string) {
    this.send({ type: 'TEXT_TRANSCRIPT', text, sessionId });
  }

  public retry() {
    log('Manual retry connection requested');
    this.reconnectAttempts = 0;
    this.transition(SocketState.LOCAL_MODE);
    this.connect();
  }

  // Listener management – prevents duplicate callbacks
  public on<E = unknown>(event: SocketEvent | string, cb: Listener<E>) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb as Listener);
  }
  public off<E = unknown>(event: SocketEvent | string, cb: Listener<E>) {
    this.listeners.get(event)?.delete(cb as Listener);
  }
  private emit<E = unknown>(event: SocketEvent | string, data?: E) {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        (cb as Listener<E>)(data as E);
      } catch (error) {
        log('Listener callback failed', event, error);
      }
    });
  }

  // ---------- State Machine ----------
  private transition(to: SocketState) {
    log('State transition', this.state, '→', to);
    this.state = to;
    // Emit corresponding lifecycle events for external observers
    switch (to) {
      case SocketState.CONNECTING:
        this.emit(SocketEvent.CONNECTING);
        break;
      case SocketState.AUTHENTICATING:
        this.emit(SocketEvent.AUTHENTICATING);
        break;
      case SocketState.CONNECTED:
        this.emit(SocketEvent.CONNECTED);
        break;
      case SocketState.LOCAL_MODE:
        this.emit(SocketEvent.LOCAL_MODE);
        break;
      case SocketState.SUSPENDED:
        this.emit(SocketEvent.SUSPENDED);
        break;
      case SocketState.RECONNECTING:
        this.emit(SocketEvent.RECONNECTING);
        break;
    }
  }

  // ---------- Connection Logic ----------
  public connect(url?: string, token?: string) {
    if (this.isSuspended) {
      log('Connect called while suspended – ignoring connection request');
      return;
    }
    if (token) this.authToken = token;
    const targetUrl = url || TransportManager.getWsUrl() || this.url;

    if (this.state !== SocketState.LOCAL_MODE && this.state !== SocketState.SUSPENDED) {
      log('Connect called but socket is already in state', this.state);
      return;
    }
    if (!this.authToken) {
      log('No auth token available for handshake – aborting connect');
      this.transition(SocketState.LOCAL_MODE);
      return;
    }
    this.transition(SocketState.CONNECTING);
    this.cleanupTimers();
    this.closeSocket();
    try {
      const delimiter = targetUrl.includes('?') ? '&' : '?';
      const connectionUrl = `${targetUrl}${delimiter}token=${encodeURIComponent(this.authToken)}`;
      this.socket = new WebSocket(connectionUrl);
    } catch (e) {
      log('WebSocket constructor threw', e);
      this.scheduleReconnect();
      return;
    }
    this.attachSocketHandlers();
  }

  private attachSocketHandlers() {
    if (!this.socket) return;
    this.socket.onopen = () => {
      log('WebSocket opened — waiting for AUTH_OK response');
      this.transition(SocketState.AUTHENTICATING);
      this.startAuthTimeout();
    };

    this.socket.onmessage = (ev) => {
      this.handleMessage(ev.data);
    };

    this.socket.onclose = () => {
      log('WebSocket closed');
      this.cleanupAfterClose();
    };

    this.socket.onerror = (ev) => {
      log('WebSocket error', ev);
      // Let onclose handle reconnection
    };
  }

  private handleMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      log('Non‑JSON message ignored');
      return;
    }
    const result = ServerMessageSchema.safeParse(parsed);
    if (!result.success) {
      log('Invalid server message', (result.error as ZodError).issues);
      return;
    }
    const msg = result.data as ServerMessage;
    switch (msg.type) {
      case 'AUTH_OK':
        this.clearAuthTimeout();
        this.transition(SocketState.CONNECTED);
        this.metrics.authLatencyMs = Date.now() - (this.authStartTimestamp ?? Date.now());
        this.flushQueue();
        this.startHeartbeat();
        break;
      case 'AUTH_FAIL':
        this.clearAuthTimeout();
        log('Authentication failed', msg);
        this.emit(SocketEvent.AUTH_FAILED, msg);
        this.socket?.close();
        this.transition(SocketState.LOCAL_MODE);
        this.scheduleReconnect();
        break;
      case 'PING':
        this.rawSend({ type: 'PONG' });
        this.emit(SocketEvent.PING);
        break;
      case 'PONG':
        this.emit(SocketEvent.PONG);
        break;
      case 'MEMORY_SAVED':
        this.emit('MEMORY_SAVED', msg);
        break;
      case 'QUERY_RESULT':
        this.emit('QUERY_RESULT', msg);
        break;
      case 'STATUS_CHANGE':
        this.emit('STATUS_CHANGE', msg);
        break;
      case 'ERROR':
        this.emit('ERROR', msg);
        break;
      case 'CALENDAR_EVENT_CREATED':
        this.emit('CALENDAR_EVENT_CREATED', msg);
        break;
      case 'PARTIAL_TRANSCRIPT':
        this.emit('PARTIAL_TRANSCRIPT', msg);
        break;
      case 'FINAL_TRANSCRIPT':
        this.emit('FINAL_TRANSCRIPT', msg);
        break;
      case 'processing_memory':
        this.emit('processing_memory', msg);
        break;
      case 'MESSAGE':
        this.emit(SocketEvent.MESSAGE, (msg as any).payload);
        break;
      default:
        // Forward unknown types as generic message
        this.emit(SocketEvent.MESSAGE, msg);
    }
  }

  // ---------- Auth Timeout ----------
  private authStartTimestamp: number | null = null;
  private startAuthTimeout() {
    this.clearAuthTimeout();
    this.authStartTimestamp = Date.now();
    this.authTimeoutTimer = setTimeout(() => {
      log('Auth timeout reached');
      this.emit(SocketEvent.AUTH_FAILED, { reason: 'timeout' });
      this.socket?.close();
      this.transition(SocketState.LOCAL_MODE);
      this.scheduleReconnect();
    }, AUTH_TIMEOUT_MS);
  }
  private clearAuthTimeout() {
    if (this.authTimeoutTimer) clearTimeout(this.authTimeoutTimer);
    this.authTimeoutTimer = null;
    this.authStartTimestamp = null;
  }

  // ---------- Heartbeat ----------
  private startHeartbeat() {
    this.stopHeartbeat();
    const ping = () => {
      if (this.state !== SocketState.CONNECTED) return;
      this.rawSend({ type: 'PING' } as ClientMessage);
      this.heartbeatTimer = setTimeout(ping, HEARTBEAT_INTERVAL_MS + (Math.random() * RECONNECT_JITTER_MS - RECONNECT_JITTER_MS / 2));
    };
    this.heartbeatTimer = setTimeout(ping, HEARTBEAT_INTERVAL_MS);
  }
  private stopHeartbeat() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  // ---------- Send / Queue ----------
  public send(data: ClientMessage) {
    // Guard against sending before authentication
    if (this.state !== SocketState.CONNECTED) {
      // Queue the message (bounded)
      if (this.messageQueue.length >= MAX_QUEUE_SIZE) {
        // Evict oldest
        this.messageQueue.shift();
        this.droppedMessageCount++;
        this.metrics.droppedMessages = this.droppedMessageCount;
        log('Message queue full – oldest dropped');
      }
      this.messageQueue.push(data);
      this.metrics.queueLength = this.messageQueue.length;
    } else {
      // Connected – send directly
      this.rawSend(data);
    }
  }

  private flushQueue() {
    if (!this.socket || this.state !== SocketState.CONNECTED) return;
    while (this.messageQueue.length) {
      const msg = this.messageQueue.shift()!;
      this.rawSend(msg);
    }
    this.metrics.queueLength = 0;
  }

  private rawSend(msg: ClientMessage) {
    // Validate outbound message before sending
    const result = ClientMessageSchema.safeParse(msg);
    if (!result.success) {
      log('Attempted to send invalid message', result.error.issues);
      return;
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    } else {
      log('rawSend called when socket not open');
    }
  }

  // ---------- AppState & Suspension Lifecycle ----------
  private setupAppStateListener() {
    if (this.appStateSubscription) return;
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const previousAppState = this.appState;
      this.appState = nextAppState;
      log(`AppState change: ${previousAppState} -> ${nextAppState}`);
      if (previousAppState === 'active' && nextAppState.match(/inactive|background/)) {
        this.suspend();
      } else if (nextAppState === 'active' && previousAppState.match(/inactive|background/)) {
        this.resume();
      }
    };
    this.appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
  }

  private suspend() {
    if (this.isSuspended) return;
    log('Suspending WebSocket transport due to app backgrounding');
    this.isSuspended = true;
    this.transition(SocketState.SUSPENDED);
    this.cleanupTimers();
    if (this.socket) {
      try {
        this.closeSocket();
      } catch (e) {
        log('Error closing socket on suspend', e);
      }
    }
  }

  private resume() {
    if (!this.isSuspended) return;
    log('Resuming WebSocket transport due to app foregrounding');
    this.isSuspended = false;
    this.reconnectAttempts = 0;
    this.transition(SocketState.LOCAL_MODE);
    this.connect();
  }

  // ---------- Reconnect Logic ----------
  private scheduleReconnect() {
    if (this.isSuspended) {
      log('scheduleReconnect skipped because socket is suspended');
      return;
    }
    if (this.reconnectScheduled || this.reconnectTimer) {
      log('Reconnect already scheduled');
      return;
    }
    if (this.state === SocketState.LOCAL_MODE && !this.isSuspended) {
      this.transition(SocketState.RECONNECTING);
    }
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      log('Maximum reconnect attempts reached');
      this.transition(SocketState.LOCAL_MODE);
      return;
    }
    const base = RECONNECT_BASE_DELAY_MS * Math.pow(1.5, this.reconnectAttempts);
    const jitter = Math.random() * RECONNECT_JITTER_MS - RECONNECT_JITTER_MS / 2;
    const delay = Math.min(base + jitter, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempts++;
    this.metrics.reconnectCount = this.reconnectAttempts;
    this.reconnectScheduled = true;
    log(`Scheduling reconnect #${this.reconnectAttempts} in ${Math.round(delay)}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectScheduled = false;
      this.connect();
    }, delay);
  }

  // ---------- Cleanup ----------
  private cleanupTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.authTimeoutTimer) clearTimeout(this.authTimeoutTimer);
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.authTimeoutTimer = null;
    this.heartbeatTimer = null;
    this.reconnectScheduled = false;
  }

  private closeSocket() {
    if (!this.socket) return;
    this.socket.onopen = null;
    this.socket.onmessage = null;
    this.socket.onerror = null;
    this.socket.onclose = null;
    try {
      this.socket.close();
    } catch {
      // no-op
    }
    this.socket = null;
  }

  private cleanupAfterClose() {
    this.stopHeartbeat();
    this.cleanupTimers();
    // Preserve queue for reconnection attempts
    if (this.state !== SocketState.LOCAL_MODE && !this.isSuspended) {
      this.transition(SocketState.LOCAL_MODE);
      this.scheduleReconnect();
    } else if (this.isSuspended) {
      this.transition(SocketState.SUSPENDED);
    }
  }

  public disconnect() {
    this.transition(SocketState.LOCAL_MODE);
    this.cleanupTimers();
    this.closeSocket();
    this.listeners.clear();
    this.messageQueue = [];
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    log('Socket manually disconnected');
  }

  // ---------- Diagnostics ----------
  public getMetrics() {
    return { ...this.metrics };
  }
}
