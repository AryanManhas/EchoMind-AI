import { useEffect, useRef } from 'react';
import { useAudioRecorder } from './useAudioRecorder';
import { useTranscriptSync } from './useTranscriptSync';
import { useMemoryEngine } from './useMemoryEngine';
import { type LanguageMode } from '../lib/voiceSettings';
import { type MobileLanguage } from '../lib/languageDetection';
import type {
  ConversationChunk,
  ConversationChunkingDiagnostics,
  ConversationTopicGroup,
} from './useConversationChunking';
import type { ConversationIntelligence } from './useConversationIntelligence';

// ─── Exported Types (must match original for external usage) ─────────────────

export type VoiceCaptureState =
  | 'idle'
  | 'passive_listening'
  | 'speech_detected'
  | 'recording'
  | 'processing'
  | 'responding'
  | 'saved'
  | 'error'
  | 'consent_required';

export type CaptureMode = 'auto' | 'manual_passive' | 'manual_instant' | 'meeting' | 'activation_window';

export interface VoiceState {
  captureState: VoiceCaptureState;
  captureMode: CaptureMode | null;
  sentences: string[];
  partialTranscript: string;
  activePartialTranscript: string;
  committedTranscriptSegments: string[];
  rollingTranscript: string;
  conversationChunks: ConversationChunk[];
  conversationIntelligence: ConversationIntelligence[];
  topicGroups: ConversationTopicGroup[];
  chunkDiagnostics: ConversationChunkingDiagnostics | null;
  error: string | null;
  sessionCount: number;  // Total captures this session
  detectedLanguage: MobileLanguage;
  sttLocale: string;
  isUploading: boolean;
  sessionId: string;
}

export const useEchoMindVoice = () => {
  // 1. Audio Recording & Permissions
  const {
    audioLevel,
    audioLevelRef,
    setAudioLevel,
    startMeetingRecording: recorderStartMeeting,
    stopMeetingRecording: recorderStopMeeting,
  } = useAudioRecorder();

  // 2. Refs for startSTT/stopSTT to break circular dependencies
  const startSTTRef = useRef<() => Promise<boolean>>(async () => false);
  const stopSTTRef = useRef<() => void>(() => {});

  // 3. Memory & Core Orchestration Engine
  const {
    state: engineState,
    handleSTTStart,
    handleSTTEnd,
    handleSTTResult,
    handleSTTError,
    enableAutoMode,
    togglePassiveMode,
    startActivationWindow,
    promoteActivationWindow,
    startInstantRecord,
    stopInstantRecord,
    startMeetingRecording,
    stopMeetingRecording,
    disableCapture,
    dismissError,
    setSttLocale,
    setDetectedLanguage,
    setError,
  } = useMemoryEngine({
    audioLevel,
    audioLevelRef,
    setAudioLevel,
    startSTTRef,
    stopSTTRef,
    startMeetingRecording: recorderStartMeeting,
    stopMeetingRecording: recorderStopMeeting,
  });

  // 4. Real-time Transcript Sync with WebSocket
  const { startSTT, stopSTT, setLanguage } = useTranscriptSync({
    captureState: engineState.captureState,
    captureMode: engineState.captureMode,
    sttLocale: engineState.sttLocale,
    setSttLocale,
    detectedLanguage: engineState.detectedLanguage,
    setDetectedLanguage,
    setAudioLevel,
    setError,
    sessionId: engineState.sessionId,
    onSTTStart: handleSTTStart,
    onSTTEnd: handleSTTEnd,
    onSTTResult: handleSTTResult,
    onSTTError: handleSTTError,
  });

  // 5. Update STT function refs
  useEffect(() => {
    startSTTRef.current = startSTT;
    stopSTTRef.current = stopSTT;
  }, [startSTT, stopSTT]);

  return {
    ...engineState,
    audioLevel,
    audioLevelRef,
    // Mode controls
    enableAutoMode,
    togglePassiveMode,
    startActivationWindow,
    promoteActivationWindow,
    startInstantRecord,
    stopInstantRecord,
    disableCapture,
    dismissError,
    setLanguage,
    startMeetingRecording,
    stopMeetingRecording,
  };
};

export default useEchoMindVoice;
