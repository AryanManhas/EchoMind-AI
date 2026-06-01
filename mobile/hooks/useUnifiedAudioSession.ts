import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { useMicrophoneLevel } from './useMicrophoneLevel';
import { useSpeechRecognitionIsolation } from './useSpeechRecognitionIsolation';
import { useWakeWord, WakeWordState } from './useWakeWord';

const LOG_PREFIX = '[UnifiedAudioSession]';

/** UI / subscriber notify cadence — not tied to meter poll. */
const LEVEL_SUBSCRIBER_MS = 200;

export type UnifiedSessionLifecycle = 'idle' | 'acquiring' | 'active' | 'releasing';

/** `wake_word` represents passive listening. */
export type UnifiedAudioOwner =
  | 'none'
  | 'metering'
  | 'recognition'
  | 'wake_word';

export type UnifiedSessionState = {
  lifecycle: UnifiedSessionLifecycle;
  owner: UnifiedAudioOwner;
};

export type AudioLevelSubscriber = (level: number) => void;

/**
 * Future-ready locale hints — continuous multilingual STT without redesigning ownership.
 */
export type UnifiedAudioLocaleHints = {
  readonly supportsCodeSwitching: true;
  readonly preferredLocales: readonly ['en-US', 'hi-IN'];
};

export const UNIFIED_AUDIO_LOCALE_HINTS: UnifiedAudioLocaleHints = {
  supportsCodeSwitching: true,
  preferredLocales: ['en-US', 'hi-IN'],
};

export interface UseUnifiedAudioSessionOptions {
  onWakeWordDetected?: () => void;
}

export type UseUnifiedAudioSessionReturn = {
  /** Single amplitude source for Orb + VAD (metering owner only). */
  audioLevel: SharedValue<number>;
  sessionState: UnifiedSessionState;
  ownershipDiagnostic: string;
  localeHints: UnifiedAudioLocaleHints;
  isMetering: boolean;
  isRecognizing: boolean;
  isPassiveListening: boolean;
  displayLevel: number;
  meterDiagnostic: string;
  permissionStatus: string;
  speechPermissionStatus: string;
  speechDiagnostic: string;
  partialTranscript: string;
  finalTranscript: string;
  displayTranscript: string;
  speechError: string | null;
  wakeWordState: WakeWordState;
  acquireSession: () => Promise<boolean>;
  releaseSession: () => Promise<void>;
  startMetering: () => Promise<boolean>;
  stopMetering: () => Promise<void>;
  startRecognition: () => Promise<boolean>;
  stopRecognition: () => Promise<void>;
  startWakeWord: () => Promise<boolean>;
  stopWakeWord: () => Promise<void>;
  subscribeAudioLevel: (subscriber: AudioLevelSubscriber) => () => void;
  clearTranscript: () => void;
};

function logDiagnostic(message: string): void {
  if (__DEV__) {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

/**
 * Central microphone authority for validation — one owner at a time, explicit transitions.
 * Composes meter + STT + wake-word drivers; does not use reactive effect chains for mutexing.
 */
export function useUnifiedAudioSession(
  options?: UseUnifiedAudioSessionOptions
): UseUnifiedAudioSessionReturn {
  const meter = useMicrophoneLevel();
  const speech = useSpeechRecognitionIsolation();
  const wakeWord = useWakeWord({
    onWakeWordDetected: options?.onWakeWordDetected || (() => {}),
  });

  const lifecycleRef = useRef<UnifiedSessionLifecycle>('idle');
  const ownerRef = useRef<UnifiedAudioOwner>('none');
  const transitionChainRef = useRef(Promise.resolve());
  const isTransitioningRef = useRef(false);
  const subscribersRef = useRef(new Set<AudioLevelSubscriber>());
  const subscriberIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastDiagnosticRef = useRef('idle');
  const mountedRef = useRef(true);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const previousOwnerRef = useRef<UnifiedAudioOwner>('none');

  const [sessionState, setSessionState] = useState<UnifiedSessionState>({
    lifecycle: 'idle',
    owner: 'none',
  });
  const [ownershipDiagnostic, setOwnershipDiagnostic] = useState('idle · owner none');

  const setDiagnostic = useCallback((message: string) => {
    if (lastDiagnosticRef.current === message) return;
    lastDiagnosticRef.current = message;
    setOwnershipDiagnostic(message);
    logDiagnostic(message);
  }, []);

  const syncSessionUi = useCallback(() => {
    const lifecycle = lifecycleRef.current;
    const owner = ownerRef.current;
    setSessionState((prev) =>
      prev.lifecycle === lifecycle && prev.owner === owner
        ? prev
        : { lifecycle, owner }
    );
    setDiagnostic(`${lifecycle} · owner ${owner}`);
  }, [setDiagnostic]);

  const clearSubscriberInterval = useCallback(() => {
    if (subscriberIntervalRef.current) {
      clearInterval(subscriberIntervalRef.current);
      subscriberIntervalRef.current = null;
    }
  }, []);

  const notifySubscribers = useCallback(() => {
    const level = meter.audioLevel.value;
    subscribersRef.current.forEach((fn) => {
      try {
        fn(level);
      } catch {
        // Stale subscriber — ignore
      }
    });
  }, [meter.audioLevel]);

  const startSubscriberPump = useCallback(() => {
    clearSubscriberInterval();
    if (ownerRef.current !== 'metering') return;
    subscriberIntervalRef.current = setInterval(
      notifySubscribers,
      LEVEL_SUBSCRIBER_MS
    );
  }, [clearSubscriberInterval, notifySubscribers]);

  const runExclusive = useCallback(
    async (label: string, action: () => Promise<void>): Promise<void> => {
      const run = async () => {
        if (isTransitioningRef.current) {
          logDiagnostic(`transition queued: ${label}`);
        }
        isTransitioningRef.current = true;
        try {
          await action();
        } finally {
          isTransitioningRef.current = false;
          if (mountedRef.current) {
            syncSessionUi();
          }
        }
      };

      const next = transitionChainRef.current.then(run, run);
      transitionChainRef.current = next;
      return next;
    },
    [syncSessionUi]
  );

  const releaseSession = useCallback(async () => {
    await runExclusive('releaseSession', async () => {
      if (
        lifecycleRef.current === 'idle' &&
        ownerRef.current === 'none' &&
        !meter.isMetering &&
        !speech.isRecognizing &&
        !wakeWord.isPassiveListening
      ) {
        return;
      }

      lifecycleRef.current = 'releasing';
      ownerRef.current = 'none';
      clearSubscriberInterval();

      await meter.stopMeter();
      await speech.stopRecognition();
      await wakeWord.stop();

      meter.audioLevel.value = 0;
      lifecycleRef.current = 'idle';
      setDiagnostic('release complete · idle');
    });
  }, [
    clearSubscriberInterval,
    meter,
    runExclusive,
    setDiagnostic,
    speech,
    wakeWord,
  ]);

  const acquireSession = useCallback(async (): Promise<boolean> => {
    let granted = false;
    await runExclusive('acquireSession', async () => {
      lifecycleRef.current = 'acquiring';
      setDiagnostic('acquiring — permissions');

      const micGranted = await meter.requestPermission();
      const speechGranted = await speech.requestPermission();
      granted = micGranted && speechGranted;

      lifecycleRef.current = 'idle';
      ownerRef.current = 'none';
      setDiagnostic(
        granted
          ? 'acquire complete — ready (no owner)'
          : 'acquire failed — permission denied'
      );
    });
    return granted;
  }, [meter, runExclusive, setDiagnostic, speech]);

  const startMetering = useCallback(async (): Promise<boolean> => {
    let ok = false;
    await runExclusive('startMetering', async () => {
      if (ownerRef.current === 'metering' && meter.isMetering) {
        ok = true;
        return;
      }

      lifecycleRef.current = 'acquiring';
      ownerRef.current = 'none';
      clearSubscriberInterval();
      setDiagnostic('acquiring — switching to metering');

      await wakeWord.stop();
      await speech.stopRecognition();
      await meter.stopMeter();

      ok = await meter.startMeter();
      if (ok) {
        ownerRef.current = 'metering';
        lifecycleRef.current = 'active';
        startSubscriberPump();
        setDiagnostic('active · owner metering');
      } else {
        ownerRef.current = 'none';
        lifecycleRef.current = 'idle';
        setDiagnostic('metering start failed · idle');
      }
    });
    return ok;
  }, [
    clearSubscriberInterval,
    meter,
    runExclusive,
    setDiagnostic,
    speech,
    startSubscriberPump,
    wakeWord,
  ]);

  const stopMetering = useCallback(async () => {
    await runExclusive('stopMetering', async () => {
      if (ownerRef.current !== 'metering' && !meter.isMetering) {
        return;
      }

      lifecycleRef.current = 'releasing';
      clearSubscriberInterval();
      await meter.stopMeter();
      meter.audioLevel.value = 0;

      ownerRef.current = 'none';
      lifecycleRef.current = 'idle';
      setDiagnostic('metering stopped · idle');
    });
  }, [clearSubscriberInterval, meter, runExclusive, setDiagnostic]);

  const startRecognition = useCallback(async (): Promise<boolean> => {
    let ok = false;
    await runExclusive('startRecognition', async () => {
      if (ownerRef.current === 'recognition' && speech.isRecognizing) {
        ok = true;
        return;
      }

      lifecycleRef.current = 'acquiring';
      clearSubscriberInterval();
      setDiagnostic('acquiring — switching to recognition');

      await wakeWord.stop();
      await meter.stopMeter();
      meter.audioLevel.value = 0;

      ok = await speech.startRecognition();
      if (ok) {
        ownerRef.current = 'recognition';
        lifecycleRef.current = 'active';
        setDiagnostic('active · owner recognition');
      } else {
        ownerRef.current = 'none';
        lifecycleRef.current = 'idle';
        setDiagnostic('recognition start failed · idle');
      }
    });
    return ok;
  }, [meter, runExclusive, setDiagnostic, speech, wakeWord, clearSubscriberInterval]);

  const stopRecognition = useCallback(async () => {
    await runExclusive('stopRecognition', async () => {
      if (ownerRef.current !== 'recognition' && !speech.isRecognizing) {
        return;
      }

      lifecycleRef.current = 'releasing';
      await speech.stopRecognition();

      ownerRef.current = 'none';
      lifecycleRef.current = 'idle';
      setDiagnostic('recognition stopped · idle');
    });
  }, [runExclusive, setDiagnostic, speech]);

  const startWakeWord = useCallback(async (): Promise<boolean> => {
    let ok = false;
    await runExclusive('startWakeWord', async () => {
      if (ownerRef.current === 'wake_word' && wakeWord.isPassiveListening) {
        ok = true;
        return;
      }

      lifecycleRef.current = 'acquiring';
      clearSubscriberInterval();
      setDiagnostic('acquiring — switching to wake_word');

      await speech.stopRecognition();
      await meter.stopMeter();
      meter.audioLevel.value = 0;

      ok = await wakeWord.start();
      if (ok) {
        ownerRef.current = 'wake_word';
        lifecycleRef.current = 'active';
        setDiagnostic('active · owner wake_word');
      } else {
        ownerRef.current = 'none';
        lifecycleRef.current = 'idle';
        setDiagnostic('wake_word start failed · idle');
      }
    });
    return ok;
  }, [meter, runExclusive, setDiagnostic, speech, wakeWord, clearSubscriberInterval]);

  const stopWakeWord = useCallback(async () => {
    await runExclusive('stopWakeWord', async () => {
      if (ownerRef.current !== 'wake_word' && !wakeWord.isPassiveListening) {
        return;
      }

      lifecycleRef.current = 'releasing';
      await wakeWord.stop();

      ownerRef.current = 'none';
      lifecycleRef.current = 'idle';
      setDiagnostic('wake_word stopped · idle');
    });
  }, [runExclusive, setDiagnostic, wakeWord]);

  const subscribeAudioLevel = useCallback(
    (subscriber: AudioLevelSubscriber) => {
      subscribersRef.current.add(subscriber);
      if (ownerRef.current === 'metering') {
        subscriber(meter.audioLevel.value);
      }
      return () => {
        subscribersRef.current.delete(subscriber);
      };
    },
    [meter.audioLevel]
  );

  const wasRecognizingRef = useRef(speech.isRecognizing);

  useEffect(() => {
    if (
      wasRecognizingRef.current &&
      !speech.isRecognizing &&
      ownerRef.current === 'recognition' &&
      !isTransitioningRef.current
    ) {
      ownerRef.current = 'none';
      lifecycleRef.current = 'idle';
      syncSessionUi();
      setDiagnostic('recognition ended (native) · idle');
    }
    wasRecognizingRef.current = speech.isRecognizing;
  }, [speech.isRecognizing, setDiagnostic, syncSessionUi]);

  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      logDiagnostic(`AppState change: ${appStateRef.current} -> ${nextAppState}`);
      
      if (appStateRef.current === 'active' && nextAppState.match(/inactive|background/)) {
        logDiagnostic(`Suspending audio session due to backgrounding. Active owner was: ${ownerRef.current}`);
        previousOwnerRef.current = ownerRef.current;
        
        await runExclusive('appStateBackground', async () => {
          const currentOwner = ownerRef.current;
          lifecycleRef.current = 'releasing';
          ownerRef.current = 'none';
          clearSubscriberInterval();

          if (currentOwner === 'wake_word') {
            await wakeWord.stop();
          } else if (currentOwner === 'recognition') {
            await speech.stopRecognition();
          } else if (currentOwner === 'metering') {
            await meter.stopMeter();
          }
          
          meter.audioLevel.value = 0;
          lifecycleRef.current = 'idle';
          logDiagnostic(`Suspension complete.`);
        });
      } else if (nextAppState === 'active' && appStateRef.current.match(/inactive|background/)) {
        logDiagnostic(`Resuming audio session due to foregrounding. Previous owner: ${previousOwnerRef.current}`);
        const targetOwner = previousOwnerRef.current;
        previousOwnerRef.current = 'none';
        
        if (targetOwner === 'wake_word') {
          await runExclusive('appStateForegroundResumeWakeWord', async () => {
            lifecycleRef.current = 'acquiring';
            const ok = await wakeWord.start();
            if (ok) {
              ownerRef.current = 'wake_word';
              lifecycleRef.current = 'active';
              logDiagnostic(`Resumed wake_word owner successfully.`);
            } else {
              ownerRef.current = 'none';
              lifecycleRef.current = 'idle';
              logDiagnostic(`Failed to resume wake_word owner.`);
            }
          });
        } else {
          logDiagnostic(`Foregrounded, staying idle since previous owner was ${targetOwner}`);
        }
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [runExclusive, clearSubscriberInterval, wakeWord, speech, meter]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearSubscriberInterval();
      logDiagnostic('unmount — release session');
      void transitionChainRef.current.then(async () => {
        lifecycleRef.current = 'releasing';
        await meter.stopMeter();
        await speech.stopRecognition();
        await wakeWord.stop();
        lifecycleRef.current = 'idle';
        ownerRef.current = 'none';
      });
    };
  }, [clearSubscriberInterval, meter, speech, wakeWord]);

  return {
    audioLevel: meter.audioLevel,
    sessionState,
    ownershipDiagnostic,
    localeHints: UNIFIED_AUDIO_LOCALE_HINTS,
    isMetering: sessionState.owner === 'metering' && meter.isMetering,
    isRecognizing:
      sessionState.owner === 'recognition' && speech.isRecognizing,
    isPassiveListening:
      sessionState.owner === 'wake_word' && wakeWord.isPassiveListening,
    displayLevel: meter.displayLevel,
    meterDiagnostic: meter.lastDiagnostic,
    permissionStatus: meter.permissionStatus,
    speechPermissionStatus: speech.permissionStatus,
    speechDiagnostic: speech.lastDiagnostic,
    partialTranscript: speech.partialTranscript,
    finalTranscript: speech.finalTranscript,
    displayTranscript: speech.displayTranscript,
    speechError: speech.errorMessage,
    wakeWordState: wakeWord.state,
    acquireSession,
    releaseSession,
    startMetering,
    stopMetering,
    startRecognition,
    stopRecognition,
    startWakeWord,
    stopWakeWord,
    subscribeAudioLevel,
    clearTranscript: speech.clearTranscript,
  };
}
