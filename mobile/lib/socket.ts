export class EchoMindSocket {
  private static instance: EchoMindSocket;
  private socket: WebSocket | null = null;
  private url: string;

  private constructor(url: string) {
    this.url = url;
  }

  public static getInstance(url: string = 'ws://192.168.29.113:8080/ws/stream'): EchoMindSocket {
    if (!EchoMindSocket.instance) {
      EchoMindSocket.instance = new EchoMindSocket(url);
    }
    return EchoMindSocket.instance;
  }

  public connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;

    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      console.log('[Socket] Connected to backend');
      this.send({ type: 'PING' });
    };

    this.socket.onmessage = (e) => {
      console.log('[Socket] Message received:', e.data);
    };

    this.socket.onclose = () => {
      console.log('[Socket] Disconnected');
    };

    this.socket.onerror = (err) => {
      console.error('[Socket] Error:', err);
    };
  }

  public send(data: any) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    } else {
      console.warn('[Socket] Not connected. Cannot send data.');
    }
  }

  public streamTranscript(text: string) {
    this.send({
      type: 'TEXT_TRANSCRIPT',
      text,
    });
  }

  public disconnect() {
    this.socket?.close();
    this.socket = null;
  }
}
