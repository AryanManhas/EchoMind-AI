import React, { useState, useRef, useEffect } from 'react';

export const PulseRecorder: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [pulseScale, setPulseScale] = useState(1);
  const [glowIntensity, setGlowIntensity] = useState(8);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      stopRecording();
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Connect to fastify websocket
      const ws = new WebSocket('ws://localhost:3000/ws/stream');
      wsRef.current = ws;

      ws.onopen = () => {
        // Standard WebM audio, often opus encoded, which FFmpeg can decode
        let options = { mimeType: 'audio/webm' };
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          options = { mimeType: 'audio/webm;codecs=opus' };
        } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
          options = { mimeType: 'audio/ogg;codecs=opus' };
        }

        const mediaRecorder = new MediaRecorder(stream, options);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(e.data);
          }
        };

        // Emit chunks every 250ms
        mediaRecorder.start(250);
        setIsRecording(true);
      };

      ws.onerror = (err) => {
        console.error('WebSocket Error:', err);
      };

      // Set up Audio Analyser for the SVG visualization
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioCtxRef.current = audioCtx;
      
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      dataArrayRef.current = dataArray;

      const updatePulse = () => {
        if (!analyserRef.current || !dataArrayRef.current) return;
        
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArrayRef.current[i];
        }
        
        const average = sum / bufferLength;
        // Scale circle between 1 and 1.6 depending on frequency amplitude
        const scale = 1 + (average / 255) * 0.6;
        // Adjust SVG blur glow intensity dynamically
        const glow = 8 + (average / 255) * 16;
        
        setPulseScale(scale);
        setGlowIntensity(glow);
        animationFrameRef.current = requestAnimationFrame(updatePulse);
      };
      
      updatePulse();

    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close();
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setIsRecording(false);
    setPulseScale(1);
    setGlowIntensity(8);
  };

  return (
    <div style={styles.container}>
      <div style={styles.glassPanel}>
        <div style={styles.visualizationWrapper}>
          <svg width="240" height="240" viewBox="0 0 240 240" style={styles.svg}>
            <defs>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation={glowIntensity} result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
              <linearGradient id="purpleBlue" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#9d4edd" />
                <stop offset="50%" stopColor="#5a189a" />
                <stop offset="100%" stopColor="#03045e" />
              </linearGradient>
            </defs>
            <circle 
              cx="120" 
              cy="120" 
              r="40" 
              fill="url(#purpleBlue)"
              filter="url(#glow)"
              style={{
                transform: `scale(${isRecording ? pulseScale : 1})`,
                transformOrigin: '120px 120px',
                transition: 'transform 0.05s ease-out, filter 0.05s ease-out',
                opacity: isRecording ? 0.9 : 0.4
              }}
            />
          </svg>
        </div>
        
        <button 
          onClick={isRecording ? stopRecording : startRecording}
          onMouseEnter={(e) => {
             e.currentTarget.style.transform = 'translateY(-2px)';
             e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
          }}
          onMouseLeave={(e) => {
             e.currentTarget.style.transform = 'translateY(0)';
             e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
          }}
          style={{
            ...styles.button,
            background: isRecording ? 'rgba(239, 35, 60, 0.85)' : 'rgba(67, 97, 238, 0.85)',
          }}
        >
          {isRecording ? 'Stop Recording' : 'Start Recording'}
        </button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#0B0B0E', // Dark background to make glass pop
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
  },
  glassPanel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem 4rem',
    background: 'rgba(255, 255, 255, 0.03)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderRadius: '30px',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
  },
  visualizationWrapper: {
    marginBottom: '2rem',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  svg: {
    overflow: 'visible'
  },
  button: {
    padding: '14px 28px',
    fontSize: '16px',
    fontWeight: '600',
    letterSpacing: '0.5px',
    color: '#ffffff',
    cursor: 'pointer',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '16px',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.2)',
    transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
    textTransform: 'uppercase',
    outline: 'none'
  }
};
