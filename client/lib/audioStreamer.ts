'use client';

export class AudioStreamer {
  private mediaRecorder: MediaRecorder | null = null;
  private socket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private animationFrameId: number | null = null;
  
  constructor(
    private onVolumeChange: (volume: number) => void,
    private onMemorySaved: (memory: any) => void,
    private onError: (err: string) => void,
    private onStatusChange?: (status: 'thinking' | 'success') => void
  ) {}

  async start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      // WebSocket Connection
      this.socket = new WebSocket('ws://localhost:8080/ws/stream');
      this.socket.onopen = () => console.log('WebSocket Audio Stream Connected');
      this.socket.onmessage = (msg) => {
        try {
          const payload = JSON.parse(msg.data);
          if (payload.type === 'processing_memory') {
            if (this.onStatusChange) this.onStatusChange('thinking');
          } else if (payload.type === 'MEMORY_SAVED') {
            this.triggerHaptic();
            if (this.onStatusChange) this.onStatusChange('success');
            this.onMemorySaved(payload.data);
          }
        } catch (e) {
          // non json message
        }
      };
      this.socket.onerror = () => this.onError('WebSocket encountered an error.');
      
      // Setup audio analyzer
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      
      const updateVolume = () => {
        if (!this.analyser || !this.dataArray) return;
        this.analyser.getByteFrequencyData(this.dataArray as any);
        const sum = this.dataArray.reduce((a, b) => a + b, 0);
        const avg = sum / this.dataArray.length;
        this.onVolumeChange(avg);
        this.animationFrameId = requestAnimationFrame(updateVolume);
      };
      updateVolume();

      // Configure MediaRecorder for streaming
      // Use webm audio format, which is standard for Chrome/Firefox
      this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(event.data);
        }
      };
      this.mediaRecorder.start(250); // Push data every 250ms

    } catch (err: any) {
      this.onError('Microphone access denied or unavailable.');
    }
  }

  stop() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.mediaRecorder = null;
    this.socket = null;
    this.audioContext = null;
    this.analyser = null;
    this.onVolumeChange(0);
  }

  private triggerHaptic() {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      // Subtle haptic double-tap
      navigator.vibrate([100, 50, 100]);
    }
  }
}
