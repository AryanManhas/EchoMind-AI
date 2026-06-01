import React, { useEffect, useState, useCallback, useRef } from 'react';
import { 
  View, 
  Text, 
  ScrollView, 
  StyleSheet, 
  TouchableOpacity, 
  Dimensions, 
  Pressable 
} from 'react-native';
import { OrbVisualizer } from '../../components/OrbVisualizer';
import { SquishButton } from '../../components/SquishButton';
import { VoiceSettingsPanel } from '../../components/VoiceSettingsPanel';
import { 
  Wifi, 
  WifiOff, 
  CheckCircle, 
  AlertCircle, 
  RefreshCw, 
  Settings as SettingsIcon,
  Zap,
  ZapOff,
  Users,
  Mic,
  MicOff,
  BookOpen,
  Trash2
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useEchoMindVoice } from '../../hooks/useEchoMindVoice';
import { useWakeWord } from '../../hooks/useWakeWord';
import { useTransport } from '../../hooks/useTransport';
import { getVoiceSettings } from '../../lib/voiceSettings';
import ENV from '../../lib/env';
import Animated, { 
  FadeIn, 
  FadeOut, 
  SlideInUp, 
  SlideOutDown
} from 'react-native-reanimated';
import { useConversationSession } from '../../hooks/useConversationSession';
import { usePersistentMemory } from '../../hooks/usePersistentMemory';
import { useReminderEngine } from '../../hooks/useReminderEngine';
import { useSemanticExtraction } from '../../hooks/useSemanticExtraction';
import { useTranscriptActivation } from '../../hooks/useTranscriptActivation';
import { useAIOrchestrator } from '../../hooks/useAIOrchestrator';
import { useGeminiStream } from '../../hooks/useGeminiStream';
import { useKnowledgeGraph } from '../../hooks/useKnowledgeGraph';
import { useProactiveAssistant, ProactiveSignal } from '../../hooks/useProactiveAssistant';
import { ProactiveSuggestionCard } from '../../components/ProactiveSuggestionCard';
import { MeetingSummaryCard } from '../../components/MeetingSummaryCard';
import { ActionItemCard } from '../../components/ActionItemCard';
import { useDailyBriefing } from '../../hooks/useDailyBriefing';
import { DailyBriefingCard } from '../../components/DailyBriefingCard';
import { useRuntimeGuardian } from '../../hooks/useRuntimeGuardian';
import { usePresentationMode } from '../../hooks/usePresentationMode';

const { width } = Dimensions.get('window');

export default function ListenerScreen() {
  const { 
    captureState, 
    captureMode,
    audioLevel, 
    partialTranscript, 
    sentences, 
    conversationChunks,
    conversationIntelligence,
    error: voiceError,
    enableAutoMode,
    togglePassiveMode,
    startInstantRecord,
    stopInstantRecord,
    disableCapture,
    dismissError,
    startMeetingRecording,
    stopMeetingRecording,
    isUploading,
    startActivationWindow
  } = useEchoMindVoice();

  const [isMeetingMode, setIsMeetingMode] = useState(false);
  const { state: transportState, forceReconnect } = useTransport();

  // --- AI Orchestration & Streaming ---
  const [syntheticSession, setSyntheticSession] = useState<any>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionTurns, setSessionTurns] = useState<any[]>([]);
  const [isInterrupted, setIsInterrupted] = useState(false);
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionTurnsRef = useRef<any[]>([]);

  const handleClearSession = useCallback(() => {
    activeSessionIdRef.current = null;
    sessionTurnsRef.current = [];
    setActiveSessionId(null);
    setSessionTurns([]);
    setSyntheticSession(null);
    if (!(global as any).isPresentationMode) {
      console.log('[DEV] session cleared');
    }
  }, []);

  const memory = usePersistentMemory();
  const reminders = useReminderEngine(memory.memories);
  const semantic = useSemanticExtraction();
  const orchestrator = useAIOrchestrator();
  const geminiStream = useGeminiStream();
  const knowledgeGraph = useKnowledgeGraph({ memories: memory.memories, reminders: reminders.tasks });
  const latestSentenceForProactive = sentences.length > 0 ? sentences[sentences.length - 1] : '';
  const activeTranscriptForProactive = partialTranscript || latestSentenceForProactive || '';
  const proactive = useProactiveAssistant({ 
    memories: memory.memories, 
    reminders: reminders.tasks, 
    knowledgeGraph,
    activeTranscript: activeTranscriptForProactive
  });
  const dailyBriefing = useDailyBriefing(memory.memories, reminders.tasks);

  // --- Runtime Guardian ---
  const guardian = useRuntimeGuardian({
    memories: memory.memories,
    reminders: reminders.tasks,
    knowledgeGraph,
    proactive,
  });

  // --- Presentation Mode ---
  const { isPresentationMode, togglePresentationMode, seedDemoData } = usePresentationMode();

  const [showSettings, setShowSettings] = useState(false);
  // Refs for values needed in the mount-only socket effect (avoids stale closures)
  const captureStateRef = useRef(captureState);
  captureStateRef.current = captureState;
  const enableAutoModeRef = useRef(enableAutoMode);
  enableAutoModeRef.current = enableAutoMode;

  // Track whether the current recording was triggered by wake word
  const wakeWordTriggeredRef = useRef(false);
  // Refs to break circular dependency between useWakeWord and voice handlers
  const stopWakeWordRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const togglePassiveModeRef = useRef(togglePassiveMode);
  togglePassiveModeRef.current = togglePassiveMode;

  // ─── Wake Word Engine ───────────────────────────────────────────────────

  const isPassiveListening = captureMode === 'activation_window';
  
  useTranscriptActivation({
    transcript: partialTranscript || latestSentenceForProactive || '',
    active: isPassiveListening,
    voiceReady: transportState === 'connected' || transportState === 'cloud_ready',
    enhanced: true,
    onActivate: (phrase) => {
      if (!(global as any).isPresentationMode) {
        console.log('[Listener] Wake word detected via useTranscriptActivation:', phrase);
      }
      startActivationWindow();
    }
  });

  const wakeWordError: string | null = null;
  const startWakeWord = useCallback(async () => {
    return startActivationWindow();
  }, [startActivationWindow]);

  const stopWakeWord = useCallback(async () => {
    disableCapture();
  }, [disableCapture]);

  // Keep ref in sync
  stopWakeWordRef.current = stopWakeWord;

  // When voice capture returns to idle after a wake-word-triggered recording,
  // restart the wake word engine to resume passive listening.
  useEffect(() => {
    if (
      captureState === 'idle' &&
      !isPassiveListening &&
      !isMeetingMode &&
      wakeWordTriggeredRef.current
    ) {
      wakeWordTriggeredRef.current = false;
      // Brief delay to ensure STT has fully released the microphone
      const timer = setTimeout(() => {
        if (!(global as any).isPresentationMode) {
          console.log('[Listener] Voice idle → restarting wake word engine');
        }
        startWakeWord();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [captureState, isPassiveListening, isMeetingMode, startWakeWord]);

  // Start activation window when idle and not in any mode
  useEffect(() => {
    if (captureState === 'idle' && captureMode === null && !isMeetingMode) {
      const timer = setTimeout(() => {
        if (!(global as any).isPresentationMode) {
          console.log('[Listener] Starting activation window...');
        }
        startActivationWindow();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [captureState, captureMode, isMeetingMode, startActivationWindow]);


  // When captureState transitions to 'saved' after a wake-word trigger,
  // cancel the auto-restart of passive mode and force back to idle for wake word.
  useEffect(() => {
    if (captureState === 'saved' && wakeWordTriggeredRef.current) {
      const timer = setTimeout(() => {
        disableCapture(); // clears timers, stops STT, sets state to idle
      }, 2600); // show "Memory Saved" briefly, then transition
      return () => clearTimeout(timer);
    }
  }, [captureState, disableCapture]);

  // ─── Socket Connection & Auto-Mode ────────────────────────────────────
  useEffect(() => {
    if (transportState === 'connected' || transportState === 'cloud_ready') {
      const settings = getVoiceSettings();
      if (settings.autoModeEnabled && captureStateRef.current === 'idle') {
        enableAutoModeRef.current();
      }
    }
  }, [transportState]);

  // ─── Streaming Orchestration ──────────────────────────────────────────
  
  // ─── Duplex Semantic Processing Queue ──────────────────────────────────────
  const previousChunksLengthRef = useRef(0);

  useEffect(() => {
    // Continuous Duplex: Instead of relying on a 'processing' state, we trigger 
    // immediately when a new conversation chunk drops (silence boundary finalized).
    if (conversationChunks && conversationChunks.length > previousChunksLengthRef.current) {
      const newChunks = conversationChunks.slice(previousChunksLengthRef.current);
      previousChunksLengthRef.current = conversationChunks.length;

      // Extract the text from the newly finalized chunks
      const newText = newChunks.map(c => c.transcript).join(' ');
      
      if (newText.trim().length > 0) {
        const currentSessionId = activeSessionIdRef.current || `cs-${Date.now().toString(36)}`;
        if (!activeSessionIdRef.current) {
          activeSessionIdRef.current = currentSessionId;
          setActiveSessionId(currentSessionId);
        }

        const newUserTurn = { role: 'user', text: newText, timestamp: Date.now() };
        const updatedTurns = [...sessionTurnsRef.current, newUserTurn];
        sessionTurnsRef.current = updatedTurns;
        setSessionTurns(updatedTurns);

        const mergedTranscript = updatedTurns
          .filter(t => t.role === 'user')
          .map(t => t.text)
          .join(' ');

        // Construct a synthetic snapshot for local mode
        const newSession = {
          sessionId: currentSessionId,
          startedAt: Date.now() - 5000,
          updatedAt: Date.now(),
          finalizedAt: Date.now(),
          state: 'finalized',
          partialTranscript: '',
          finalizedTranscript: mergedTranscript,
          mergedTranscript: mergedTranscript,
          utteranceCount: updatedTurns.length,
          silenceTransitions: 1,
          localeHints: { primaryLocale: 'en-US', detectedLocales: [] },
          durationMs: 5000,
          turns: updatedTurns,
        } as any;
        setSyntheticSession(newSession);

        // Perform semantic extraction synchronously
        const extractionResult = semantic.extractSemanticIntentSync(newText, currentSessionId);
        
        // Save to persistent memory immediately, with the extraction!
        void memory.saveMemory(newSession, extractionResult);
        
        // Immediately trigger the AI orchestrator to evaluate the new context
        // and stream a response back if needed.
        // We do this while the microphone continues recording!
        orchestrator.assembleContext(
          newSession,
          memory.memories,
          reminders.tasks,
          null
        );
      }
    }
  }, [conversationChunks, memory, orchestrator, reminders.tasks, semantic]);

  // Capture assistant response when stream completes
  useEffect(() => {
    if (geminiStream.streamState === 'completed' && geminiStream.finalResponse && activeSessionIdRef.current) {
      const assistantText = geminiStream.finalResponse;
      const turns = sessionTurnsRef.current;
      const lastTurn = turns[turns.length - 1];
      if (lastTurn && lastTurn.role === 'assistant' && lastTurn.text === assistantText) {
        return;
      }
      
      const newAssistantTurn = { role: 'assistant', text: assistantText, timestamp: Date.now() };
      const updatedTurns = [...turns, newAssistantTurn];
      sessionTurnsRef.current = updatedTurns;
      setSessionTurns(updatedTurns);

      const mergedTranscript = updatedTurns
        .filter(t => t.role === 'user')
        .map(t => t.text)
        .join(' ');

      const updatedSession = {
        sessionId: activeSessionIdRef.current,
        startedAt: Date.now() - 5000,
        updatedAt: Date.now(),
        finalizedAt: Date.now(),
        state: 'finalized',
        partialTranscript: '',
        finalizedTranscript: mergedTranscript,
        mergedTranscript: mergedTranscript,
        utteranceCount: updatedTurns.length,
        silenceTransitions: 1,
        localeHints: { primaryLocale: 'en-US', detectedLocales: [] },
        durationMs: 5000,
        turns: updatedTurns,
      } as any;

      setSyntheticSession(updatedSession);
      void memory.saveMemory(updatedSession, null);
      
      if (!(global as any).isPresentationMode) {
        console.log('[DEV] Threaded assistant response into session:', activeSessionIdRef.current);
      }
    }
  }, [geminiStream.streamState, geminiStream.finalResponse, memory.saveMemory]);

  useEffect(() => {
    if (captureState === 'speech_detected' || captureState === 'recording') {
      setSyntheticSession(null);
      // User interrupted -> instantly abort stream
      if (geminiStream.streamState === 'streaming' || geminiStream.streamState === 'preparing') {
        geminiStream.cancelStream(); 
        setIsInterrupted(true);
        const timer = setTimeout(() => setIsInterrupted(false), 1200);
        return () => clearTimeout(timer);
      }
    }
  }, [
    captureState, 
    syntheticSession, 
    memory.memories, 
    reminders.tasks, 
    semantic.extraction, 
    orchestrator, 
    geminiStream
  ]);

  useEffect(() => {
    if (orchestrator.orchestratorState === 'ready' && orchestrator.latestContextPayload) {
      if (guardian.throttles.shouldPauseStreaming) {
        if (__DEV__) console.log('[Listener] Suppressing gemini stream due to Guardian throttles');
        orchestrator.resetOrchestrator();
        return;
      }
      geminiStream.generateStream(orchestrator.latestContextPayload);
      orchestrator.resetOrchestrator();
    }
  }, [orchestrator.orchestratorState, orchestrator.latestContextPayload, guardian.throttles.shouldPauseStreaming]);

  const getEffectiveCaptureState = () => {
    if (isInterrupted) return 'interrupted';
    if (captureState === 'speech_detected') return 'speech_detected';
    if (geminiStream.streamState === 'streaming') return 'responding';
    if (geminiStream.streamState === 'preparing' || captureState === 'processing') return 'thinking';
    if (captureState === 'recording') return 'listening';
    if (captureMode === 'activation_window') return 'activation_detected';
    return captureState;
  };

  const effectiveCaptureState = getEffectiveCaptureState();

  // ─── Event Handlers ─────────────────────────────────────────────────────

  const handleRetryConnection = useCallback(() => {
    forceReconnect();
  }, [forceReconnect]);

  const handleProactiveSuggestionPress = useCallback((signal: ProactiveSignal) => {
    if (captureState === 'idle' || captureState === 'passive_listening') {
      stopWakeWord().then(() => {
        wakeWordTriggeredRef.current = true;
        startInstantRecord();
      });
    }
  }, [captureState, startInstantRecord, stopWakeWord]);

  // ─── Derived State ─────────────────────────────────────────────────────

  const getSanitizedError = (error: string | null) => {
    if (!error) return null;
    const lower = error.toLowerCase();
    if (
      lower.includes('websocket') ||
      lower.includes('connection lost') ||
      lower.includes('connection failed') ||
      lower.includes('port 8080') ||
      lower.includes('localhost') ||
      lower.includes('transport') ||
      lower.includes('network') ||
      lower.includes('fetch')
    ) {
      return 'Operating in local companion mode.';
    }
    if (
      lower.includes('permission') ||
      lower.includes('consent') ||
      lower.includes('microphone') ||
      lower.includes('access denied')
    ) {
      return 'Microphone access is needed to listen.';
    }
    if (lower.includes('upload') || lower.includes('sync')) {
      return 'Context preserved locally.';
    }
    return 'EchoMind is ready.';
  };

  const latestSentence = sentences.length > 0 ? sentences[sentences.length - 1] : '';
  const displayTranscript = partialTranscript || latestSentence || '';
  const isRecording = captureState === 'recording' || captureState === 'speech_detected';
  const isPassive = captureState === 'passive_listening';
  const isAuto = captureMode === 'auto';
  const combinedError = getSanitizedError(voiceError || wakeWordError);

  // ─── Orb Interactions ─────────────────────────────────────────────────

  const handleOrbPress = () => {
    if (isMeetingMode) {
      if (captureState === 'recording') {
        stopMeetingRecording();
      } else if (captureState === 'idle' || captureState === 'passive_listening') {
        startMeetingRecording();
      }
    } else if (isRecording || captureState === 'passive_listening') {
      // If actively recording or listening, stop and return to wake word
      disableCapture();
      wakeWordTriggeredRef.current = false;
      setTimeout(() => startWakeWord(), 500);
    } else {
      // Idle / wake word listening: manually start passive mode
      stopWakeWord().then(() => {
        wakeWordTriggeredRef.current = true;
        togglePassiveMode();
      });
    }
  };

  const handleOrbLongPress = () => {
    stopWakeWord().then(() => {
      wakeWordTriggeredRef.current = true;
      startInstantRecord();
    });
  };

  const handleOrbPressOut = () => {
    if (captureMode === 'manual_instant') {
      stopInstantRecord();
    }
  };

  const handleSettingsLongPress = useCallback(async () => {
    togglePresentationMode();
    await seedDemoData(memory.reloadMemory, reminders.reloadTasks);
  }, [togglePresentationMode, seedDemoData, memory.reloadMemory, reminders.reloadTasks]);

  return (
    <View style={styles.container}>{/* Runtime diagnostics have been visually suppressed for production Polish */}
      {/* Background gradient */}
      <LinearGradient
        colors={['rgba(199, 153, 255, 0.03)', 'rgba(74, 248, 227, 0.01)', 'transparent']}
        style={styles.bgGradient}
      />

      <View style={styles.header}>
        <TouchableOpacity 
          onPress={() => setShowSettings(!showSettings)}
          onLongPress={handleSettingsLongPress}
          delayLongPress={2000}
          style={styles.iconButton}
        >
          <SettingsIcon color={showSettings ? "#c799ff" : "#acaab0"} size={22} />
        </TouchableOpacity>

        {!isPresentationMode && (
          <View style={styles.statusPillContainer}>
            <TouchableOpacity
              style={[
                styles.statusPill,
                (transportState === 'connected' || transportState === 'cloud_ready') && styles.statusConnected,
                (transportState === 'local_ready' || transportState === 'offline_ready' || transportState === 'degraded') && styles.statusDisconnected,
              ]}
              onPress={(transportState === 'local_ready' || transportState === 'offline_ready' || transportState === 'degraded') ? handleRetryConnection : undefined}
              activeOpacity={(transportState === 'local_ready' || transportState === 'offline_ready' || transportState === 'degraded') ? 0.7 : 1}
            >
              {(transportState === 'connected' || transportState === 'cloud_ready') ? (
                <Wifi color="#4af8e3" size={12} />
              ) : (transportState === 'connecting' || transportState === 'reconnecting' || transportState === 'discovering') ? (
                <RefreshCw color="#c799ff" size={12} />
              ) : (
                <WifiOff color="#acaab0" size={12} />
              )}
              <Text style={styles.statusText}>EchoMind is ready</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.headerRightGroup}>
          {activeSessionId !== null && (
            <TouchableOpacity 
              onPress={handleClearSession}
              style={[styles.iconButton, { borderColor: 'rgba(252, 165, 165, 0.2)' }]}
            >
              <Trash2 color="#fca5a5" size={20} />
            </TouchableOpacity>
          )}
          <TouchableOpacity 
            onPress={() => dailyBriefing.generateBriefing(true)}
            style={styles.iconButton}
          >
            <BookOpen color="#c799ff" size={20} />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => {
              setIsMeetingMode(!isMeetingMode);
              if (captureState !== 'idle') disableCapture();
            }}
            style={[styles.iconButton, isMeetingMode && styles.iconButtonActive]}
          >
            <Users color={isMeetingMode ? "#4af8e3" : "#acaab0"} size={22} />
          </TouchableOpacity>
        </View>
      </View>

      {!!showSettings && (
        <VoiceSettingsPanel 
          onClose={() => setShowSettings(false)} 
          onSettingsChanged={(s) => {
            if (s.autoModeEnabled) enableAutoMode();
            else if (captureMode === 'auto') disableCapture();
          }}
        />
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Orb Container */}
        <View style={styles.orbContainer}>
          <SquishButton
            onPress={handleOrbPress}
            onLongPress={handleOrbLongPress}
            onPressOut={handleOrbPressOut}
            delayLongPress={300}
            haptic="medium"
            squishScale={0.92}
          >
            <OrbVisualizer captureState={effectiveCaptureState as any} audioLevel={audioLevel} isWakeWordListening={isPassiveListening} />
          </SquishButton>
        </View>

        {/* State Banner */}
        <View style={styles.stateBannerContainer}>
           {combinedError && !isPresentationMode ? (
             <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.errorBanner}>
               <AlertCircle color="#ef4444" size={16} />
               <Text style={styles.errorText}>{combinedError}</Text>
               <TouchableOpacity onPress={dismissError}>
                 <Text style={styles.dismissText}>Dismiss</Text>
               </TouchableOpacity>
             </Animated.View>
           ) : (
              <View style={styles.modeIndicator}>
                <Text style={styles.modeText}>
                  {isMeetingMode ? 'Meeting Mode' :
                   captureMode === 'auto' ? 'Auto-Capture' : 
                   captureMode === 'manual_passive' ? 'Passive Listening' :
                   captureMode === 'manual_instant' ? 'Instant Record' :
                   isPassiveListening ? 'Listening for EchoMind' : 'Tap Orb or say "Hey EchoMind"'}
                </Text>
                <Text style={styles.modeSubtext}>
                  {isMeetingMode ? 
                   (captureState === 'recording' ? 'Recording high-quality audio...' : 'Tap orb to start recording') :
                   captureMode === 'auto' ? 'Monitoring environment...' : 
                   captureMode === 'manual_passive' ? 'Waiting for speech...' :
                   captureMode === 'manual_instant' ? 'Recording now...' :
                   isPassiveListening ? 'Say "EchoMind" to start recording...' : 'Tap orb to start, or hold for instant capture'}
                </Text>
             </View>
           )}
        </View>

        {/* Live Transcript Display */}
        <View style={styles.transcriptContainer}>
          {geminiStream.streamState === 'streaming' || geminiStream.streamState === 'completed' || geminiStream.streamState === 'preparing' ? (
            <Animated.View entering={FadeIn} style={styles.transcriptBox}>
              <Text style={styles.transcriptText}>
                {geminiStream.partialResponse || geminiStream.finalResponse || '...'}
              </Text>
            </Animated.View>
          ) : isRecording ? (
            <Animated.View entering={FadeIn} style={styles.transcriptBox}>
              <Text style={styles.transcriptText}>
                {displayTranscript || '...'}
              </Text>
            </Animated.View>
          ) : captureState === 'processing' || isUploading ? (
            <Animated.View entering={FadeIn} style={styles.processingBox}>
               <RefreshCw color="#c799ff" size={24} style={styles.spin} />
               <Text style={styles.processingText}>
                 {isUploading ? 'Uploading to secure vault...' : 'Syncing memory to neural cloud...'}
               </Text>
            </Animated.View>
          ) : captureState === 'saved' ? (
            <Animated.View entering={FadeIn} style={styles.savedBox}>
               <CheckCircle color="#4af8e3" size={24} />
               <Text style={styles.savedText}>Memory Captured</Text>
            </Animated.View>
          ) : (
            <View style={styles.idleHint}>
              {dailyBriefing.briefing.isActive ? (
                <DailyBriefingCard 
                  briefing={dailyBriefing.briefing} 
                  onDismiss={dailyBriefing.dismissBriefing} 
                />
              ) : (!guardian.throttles.shouldThrottleProactive && proactive.topSignals.filter(s => !s.dismissed).slice(0, 2).length > 0) ? (
                <View style={styles.proactiveContainer}>
                  {proactive.topSignals.filter(s => !s.dismissed).slice(0, 2).map((signal, index) => (
                    <ProactiveSuggestionCard
                      key={signal.signalId}
                      signal={signal}
                      index={index}
                      onPress={handleProactiveSuggestionPress}
                      onDismiss={(s) => proactive.dismissSignal(s.signalId)}
                    />
                  ))}
                </View>
              ) : (
                <Text style={styles.idleHintText}>
                  {guardian.mode === 'safe_mode' ? 'Refreshing context...' :
                   isPassiveListening ? 'Say "Hey EchoMind" to begin...' : '"Remember to buy coffee tomorrow"'}
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Recent Activity Feed */}
        {!!(conversationIntelligence && conversationIntelligence.length > 0) && (
          <View style={[styles.feedContainer, { marginBottom: sentences.length > 0 ? 0 : 20 }]}>
            {conversationIntelligence.slice(-1).map((intel, idx) => (
              <View key={`intel-${intel.chunkId}-${idx}`}>
                {!!(intel.meetingSummary && intel.participants && intel.participants.length > 0) && (
                  <MeetingSummaryCard summary={intel.meetingSummary} participants={intel.participants} />
                )}
                {!!(intel.assignments && intel.assignments.length > 0) && intel.assignments.map((assignment, i) => (
                  <ActionItemCard 
                    key={`assignment-${i}`} 
                    person={assignment.person} 
                    responsibility={assignment.responsibility} 
                  />
                ))}
              </View>
            ))}
          </View>
        )}

        {sentences.length > 0 && (
          <View style={styles.feedContainer}>
            <View style={styles.feedHeader}>
              <View style={styles.liveDot} />
              <Text style={styles.feedTitle}>Session Intelligence</Text>
            </View>
            {sentences.slice(-3).reverse().map((s, i, arr) => (
              <Animated.View 
                key={`sentence-${sentences.length - 1 - i}`} 
                entering={FadeIn.delay(i * 100)} 
                style={styles.feedItem}
              >
                <Text style={styles.feedText}>{s}</Text>
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0e0e12',
  },
  bgGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '60%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 24,
    zIndex: 10,
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  iconButtonActive: {
    backgroundColor: 'rgba(74, 248, 227, 0.1)',
    borderColor: 'rgba(74, 248, 227, 0.3)',
  },
  statusPillContainer: {
    flex: 1,
    alignItems: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'transparent',
  },
  statusConnected: {
  },
  statusDisconnected: {
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 0.5,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  orbContainer: {
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 20,
  },
  stateBannerContainer: {
    alignItems: 'center',
    paddingHorizontal: 40,
    minHeight: 60,
  },
  modeIndicator: {
    alignItems: 'center',
  },
  modeText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  modeSubtext: {
    color: '#777',
    fontSize: 13,
    marginTop: 4,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    gap: 10,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    flex: 1,
  },
  dismissText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  transcriptContainer: {
    marginTop: 30,
    paddingHorizontal: 30,
    minHeight: 120,
    justifyContent: 'center',
  },
  transcriptBox: {
    width: '100%',
  },
  transcriptText: {
    color: '#fcf8fe',
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  processingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  processingText: {
    color: '#c799ff',
    fontSize: 16,
    fontWeight: '600',
  },
  savedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  savedText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    fontWeight: '500',
  },
  idleHint: {
    opacity: 0.3,
  },
  idleHintText: {
    color: '#acaab0',
    fontSize: 16,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  proactiveContainer: {
    width: '100%',
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  feedContainer: {
    marginTop: 40,
    paddingHorizontal: 24,
  },
  feedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4af8e3',
  },
  feedTitle: {
    color: '#4af8e3',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  feedItem: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  feedText: {
    color: '#acaab0',
    fontSize: 14,
    lineHeight: 20,
  },
  spin: {
    // Rotation handled by reanimated or simple transform if static
  }
});
