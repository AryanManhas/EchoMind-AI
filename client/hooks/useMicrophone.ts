'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import { saveMemoryLocal } from '../lib/persistence';
import { useNotifications } from '@/src/components/NotificationProvider';

export function useMicrophone(onMemorySaved?: (memory: any) => void) {
  const [active, setActive] = useState(false);
  const { addNotification } = useNotifications();
  const [audioLevel, setAudioLevel] = useState(0);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.close();
    }
    
    setActive(false);
    setAudioLevel(0);
    setIsThinking(false);
    setIsConnected(false);
  }, []);

  // Monitor connection state
  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080';
    const checkSocket = () => {
      if (!socketRef.current || socketRef.current.readyState === WebSocket.CLOSED) {
        setIsConnected(false);
      } else if (socketRef.current.readyState === WebSocket.OPEN) {
        setIsConnected(true);
      }
    };
    
    const interval = setInterval(checkSocket, 2000);
    return () => clearInterval(interval);
  }, []);

  const startCapture = async () => {
    try {
      setError(null);

      // 1. Hardware Safety Check
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const warning = "Hardware unavailable. If on mobile/insecure origin, enable: chrome://flags/#unsafely-treat-insecure-origin-as-secure and add http://192.168.29.113:3000";
        console.warn(`[DEBUG] ${warning}`);
        throw new Error("Local Hardware Blocked (Check Chrome Flags)");
      }
      
      // 2. Establish WebSocket Connection
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080';
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => setIsConnected(true);

      socket.onmessage = (msg) => {
        const payload = JSON.parse(msg.data);
        if (payload.type === 'processing_memory') {
          setIsThinking(true);
        } else if (payload.type === 'MEMORY_SAVED') {
          setIsThinking(false);
          saveMemoryLocal(payload.data); // Persistence for mobile
          
          // Smart Notification Trigger
          const mem = payload.data;
          
          // 1. Reminder Confidence System (High confidence tasks)
          if (mem.category === 'Task' && mem.importance > 0.6) {
            const hasDate = !!mem.nextActionDate;
            const scheduledTime = hasDate ? new Date(mem.nextActionDate).getTime() : undefined;
            const actionType = hasDate ? 'reminder' : undefined;
            
            // Immediate contextual nudge
            addNotification({
              title: "Reminder Scheduled",
              message: `I'll remind you about: "${mem.title}"`,
              priority: 'important',
              actionType,
              memoryId: mem.id
            });
            
            // Future proactive reminder window (e.g. 15m before)
            if (scheduledTime && scheduledTime > Date.now()) {
              addNotification({
                title: mem.title,
                message: `Upcoming soon: ${mem.summary}`,
                priority: mem.importance >= 0.8 ? 'urgent' : 'normal',
                scheduledFor: scheduledTime - 15 * 60 * 1000, // 15 mins before
                actionType,
                memoryId: mem.id
              });
            }
          } else if (mem.category === 'Fact' && mem.importance >= 0.7) {
            // Meeting / Intelligence Extraction
            addNotification({
              title: "Insight Extracted",
              message: mem.title,
              priority: 'normal',
              actionType: 'insight',
              memoryId: mem.id
            });
          }

          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([10, 30, 10]); // Haptic signal
          }
          if (onMemorySaved) onMemorySaved(payload.data);
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        if (active) {
            setError('Connection lost');
            cleanup();
        }
      };
      
      socket.onerror = () => {
        setIsConnected(false);
        setError('Hardware loop failed (Port 8080)');
      };

      // 3. Get Audio Stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 16000 },
          channelCount: { ideal: 1 },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      // 4. Analysis & Recording
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((p, c) => p + c, 0) / dataArray.length;
        setAudioLevel(avg);
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };
      animationFrameRef.current = requestAnimationFrame(updateLevel);

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
          socket.send(event.data);
        }
      };

      mediaRecorder.start(100);
      setActive(true);
      
      // Hardware Haptics for PWA feel
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([10, 30, 10]);
      }

    } catch (err: any) {
      setError(err.message || 'Access denied');
      cleanup();
    }
  };

  const stopCapture = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([10, 30, 10]);
    }
    cleanup();
  };

  return {
    active,
    audioLevel,
    isThinking,
    error,
    isConnected,
    startCapture,
    stopCapture
  };
}
