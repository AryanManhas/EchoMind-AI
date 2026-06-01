import { useCallback, useEffect, useRef, useState } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import { useSharedValue } from 'react-native-reanimated';

/** ~30 Hz — matches typical voice meter cadence without bridge flooding. */
export const SIMULATED_AUDIO_TICK_MS = 33;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Deterministic audioLevel for isolated Orb validation.
 * No microphone, expo-av, or native audio subscriptions.
 */
export function useSimulatedAudioLevel() {
  const audioLevel = useSharedValue(0);
  const [waveformActive, setWaveformActive] = useState(false);
  const [manualLevel, setManualLevel] = useState(0);
  const phaseRef = useRef(0);

  const setLevel = useCallback(
    (level: number) => {
      const clamped = clamp01(level);
      setManualLevel(clamped);
      audioLevel.value = clamped;
    },
    [audioLevel]
  );

  const startWaveform = useCallback(() => {
    phaseRef.current = 0;
    setWaveformActive(true);
  }, []);

  const stopWaveform = useCallback(() => {
    if (!waveformActive) {
      if (audioLevel.value !== 0) {
        audioLevel.value = 0;
      }
      return;
    }
    setWaveformActive(false);
    audioLevel.value = 0;
    setManualLevel(0);
  }, [audioLevel, waveformActive]);

  useEffect(() => {
    if (!waveformActive) return;

    const driveId = setInterval(() => {
      phaseRef.current += SIMULATED_AUDIO_TICK_MS / 1000;
      const t = phaseRef.current;
      const sine = Math.sin(t * 4.2) * Math.cos(t * 1.7);
      audioLevel.value = clamp01(0.5 + 0.48 * sine);
    }, SIMULATED_AUDIO_TICK_MS);

    const displayId = setInterval(() => {
      setManualLevel(audioLevel.value);
    }, 200);

    return () => {
      clearInterval(driveId);
      clearInterval(displayId);
    };
  }, [waveformActive, audioLevel]);

  return {
    audioLevel,
    manualLevel,
    waveformActive,
    setLevel,
    startWaveform,
    stopWaveform,
  };
}

export type SimulatedAudioLevelHandle = {
  audioLevel: SharedValue<number>;
  manualLevel: number;
  waveformActive: boolean;
  setLevel: (level: number) => void;
  startWaveform: () => void;
  stopWaveform: () => void;
};
