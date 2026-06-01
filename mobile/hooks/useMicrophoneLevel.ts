import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

const LOG_PREFIX = '[MicrophoneLevel]';

/** ~25 Hz meter polling — within 15–30 Hz target, avoids bridge flooding. */
export const MICROPHONE_METER_POLL_MS = 40;

/** UI readout refresh only — not tied to meter cadence. */
const DISPLAY_READOUT_MS = 200;

export type MicrophonePermissionStatus =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'undetermined';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Map expo-av metering dB (~-160…0) to 0–1 for orb reactivity.
 * Tuned for speech, not full-scale digital 0 dBFS.
 */
export function normalizeMeteringDb(db: number): number {
  const SILENCE_DB = -55;
  const LOUD_DB = -8;
  if (!Number.isFinite(db)) return 0;
  if (db <= SILENCE_DB) return 0;
  if (db >= LOUD_DB) return 1;
  return clamp01((db - SILENCE_DB) / (LOUD_DB - SILENCE_DB));
}

const METERING_RECORDING_OPTIONS = {
  ...Audio.RecordingOptionsPresets.LOW_QUALITY,
  android: {
    ...Audio.RecordingOptionsPresets.LOW_QUALITY.android,
    meteringEnabled: true,
  },
  ios: {
    ...Audio.RecordingOptionsPresets.LOW_QUALITY.ios,
    meteringEnabled: true,
  },
  web: Audio.RecordingOptionsPresets.LOW_QUALITY.web,
};

function logDiagnostic(message: string): void {
  if (__DEV__) {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

export type UseMicrophoneLevelReturn = {
  audioLevel: SharedValue<number>;
  isMetering: boolean;
  permissionStatus: MicrophonePermissionStatus;
  displayLevel: number;
  lastDiagnostic: string;
  requestPermission: () => Promise<boolean>;
  startMeter: () => Promise<boolean>;
  stopMeter: () => Promise<void>;
};

/**
 * Isolated live microphone amplitude meter — no STT, transcript, or websocket.
 * Updates SharedValue only; React state is throttled for diagnostics UI.
 */
export function useMicrophoneLevel(): UseMicrophoneLevelReturn {
  const audioLevel = useSharedValue(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const displayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isStoppingRef = useRef(false);
  const isStartingRef = useRef(false);

  const [isMetering, setIsMetering] = useState(false);
  const [permissionStatus, setPermissionStatus] =
    useState<MicrophonePermissionStatus>('unknown');
  const [displayLevel, setDisplayLevel] = useState(0);
  const [lastDiagnostic, setLastDiagnostic] = useState('idle');
  const lastDiagnosticRef = useRef('idle');

  const setDiagnostic = useCallback((message: string) => {
    if (lastDiagnosticRef.current === message) return;
    lastDiagnosticRef.current = message;
    setLastDiagnostic(message);
    logDiagnostic(message);
  }, []);

  const clearPollInterval = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const clearDisplayInterval = useCallback(() => {
    if (displayIntervalRef.current) {
      clearInterval(displayIntervalRef.current);
      displayIntervalRef.current = null;
    }
  }, []);

  const releaseRecording = useCallback(async () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
    } catch {
      // Already stopped during teardown
    }
  }, []);

  const stopMeter = useCallback(async () => {
    const alreadyIdle =
      !isMetering &&
      recordingRef.current == null &&
      pollIntervalRef.current == null &&
      displayIntervalRef.current == null;
    if (alreadyIdle || isStoppingRef.current) {
      return;
    }

    isStoppingRef.current = true;
    setDiagnostic('meter stop requested');

    clearPollInterval();
    clearDisplayInterval();
    if (isMetering) {
      setIsMetering(false);
    }

    await releaseRecording();

    audioLevel.value = 0;
    setDisplayLevel((prev) => (prev === 0 ? prev : 0));
    setDiagnostic('meter stop complete — cleanup done');
    isStoppingRef.current = false;
  }, [
    audioLevel,
    clearDisplayInterval,
    clearPollInterval,
    isMetering,
    releaseRecording,
    setDiagnostic,
  ]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { granted, status } = await Audio.requestPermissionsAsync();
      const next: MicrophonePermissionStatus = granted
        ? 'granted'
        : status === 'denied'
          ? 'denied'
          : 'undetermined';
      setPermissionStatus(next);
      setDiagnostic(`permission ${next}`);
      return granted;
    } catch (error) {
      setPermissionStatus('denied');
      setDiagnostic('permission request failed');
      console.warn(LOG_PREFIX, error);
      return false;
    }
  }, [setDiagnostic]);

  const startMeter = useCallback(async (): Promise<boolean> => {
    if (isStartingRef.current || isMetering || recordingRef.current) {
      setDiagnostic('meter start skipped — already active');
      return false;
    }

    isStartingRef.current = true;
    setDiagnostic('meter start requested');

    try {
      const granted = await requestPermission();
      if (!granted) {
        setDiagnostic('meter start aborted — permission denied');
        return false;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const { recording } = await Audio.Recording.createAsync(
        METERING_RECORDING_OPTIONS
      );

      recordingRef.current = recording;
      setIsMetering(true);
      setDiagnostic('meter start complete — polling');

      pollIntervalRef.current = setInterval(async () => {
        const active = recordingRef.current;
        if (!active || isStoppingRef.current) return;
        try {
          const status = await active.getStatusAsync();
          if (status.isRecording && status.metering != null) {
            audioLevel.value = normalizeMeteringDb(status.metering);
          }
        } catch {
          // Teardown race — ignore
        }
      }, MICROPHONE_METER_POLL_MS);

      displayIntervalRef.current = setInterval(() => {
        setDisplayLevel(audioLevel.value);
      }, DISPLAY_READOUT_MS);

      return true;
    } catch (error) {
      setDiagnostic('meter start failed');
      console.warn(LOG_PREFIX, error);
      await stopMeter();
      return false;
    } finally {
      isStartingRef.current = false;
    }
  }, [
    audioLevel,
    isMetering,
    requestPermission,
    setDiagnostic,
    stopMeter,
  ]);

  useEffect(() => {
    return () => {
      logDiagnostic('unmount — releasing meter');
      clearPollInterval();
      clearDisplayInterval();
      const recording = recordingRef.current;
      recordingRef.current = null;
      if (recording) {
        recording.stopAndUnloadAsync().catch(() => {});
      }
      audioLevel.value = 0;
    };
  }, [audioLevel, clearDisplayInterval, clearPollInterval]);

  return {
    audioLevel,
    isMetering,
    permissionStatus,
    displayLevel,
    lastDiagnostic,
    requestPermission,
    startMeter,
    stopMeter,
  };
}
