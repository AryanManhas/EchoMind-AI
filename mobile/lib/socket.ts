type Listener = (data: any) => void;

export class EchoMindSocket {
  private static instance: EchoMindSocket;
  private socket: WebSocket | null = null;
  private url: string;
  private listeners: Record<string, Listener[]> = {};
  
  // Reconnection state
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 3000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;
  private manualDisconnect = false;

  // Offline queue
  private messageQueue: any[] = [];

  private constructor(url: string) {
    this.url = url;
  }

  public static getInstance(): EchoMindSocket {
    const wsUrl = process.env.EXPO_PUBLIC_WS_URL || 'ws://192.168.29.113:8080';
    if (!EchoMindSocket.instance) {
      EchoMindSocket.instance = new EchoMindSocket(wsUrl);
    }
    return EchoMindSocket.instance;
  }

  public on(event: string, callback: Listener) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  public off(event: string, callback: Listener) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
  }

  private emit(event: string, data?: any) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => cb(data));
    }
  }

  public get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  public get status(): 'connected' | 'connecting' | 'disconnected' {
    if (this.socket?.readyState === WebSocket.OPEN) return 'connected';
    if (this.isConnecting) return 'connecting';
    return 'disconnected';
  }

  public connect() {
    if (this.socket?.readyState === WebSocket.OPEN || this.isConnecting) return;

    this.manualDisconnect = false;
    this.isConnecting = true;
    this.emit('connecting');

    try {
      this.socket = new WebSocket(this.url);
    } catch (e) {
      // WebSocket constructor can throw on invalid URL
      this.isConnecting = false;
      this.emit('disconnected');
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      console.log('[Socket] ✓ Connected');
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.emit('connected');
      this.flushQueue();
    };

    this.socket.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data as string);
        if (payload.type) {
          this.emit(payload.type, payload);
        } else {
          this.emit('message', payload);
        }
      } catch {
        // Non-JSON message, ignore
      }
    };

    this.socket.onclose = () => {
      this.isConnecting = false;
      this.socket = null;
      this.emit('disconnected');

      if (!this.manualDisconnect) {
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = () => {
      // Errors are always followed by onclose, so just mark connecting false
      this.isConnecting = false;
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      // Exponential backoff: 3s, 6s, 12s, 24s... capped at 30s
      const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 30000);
      console.log(`[Socket] Reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${(delay/1000).toFixed(0)}s`);
      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.log('[Socket] Backend unreachable — will retry when you send a message');
      this.emit('reconnect_failed');
    }
  }

  /** Reset reconnect counter and try again immediately */
  public retry() {
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.connect();
  }

  private flushQueue() {
    while (this.messageQueue.length > 0 && this.socket?.readyState === WebSocket.OPEN) {
      const msg = this.messageQueue.shift();
      this.socket.send(JSON.stringify(msg));
    }
  }

  public send(data: any) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    } else {
      this.messageQueue.push(data);
      // Auto-reconnect when sending
      if (!this.manualDisconnect && !this.isConnecting) {
        this.reconnectAttempts = 0;
        this.connect();
      }
    }
  }

  public streamTranscript(text: string) {
    if (!text || !text.trim()) return;
    this.send({
      type: 'TEXT_TRANSCRIPT',
      text: text.trim(),
    });
  }

  public disconnect() {
    this.manualDisconnect = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }
}
