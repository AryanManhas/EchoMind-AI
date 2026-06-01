import { useState, useCallback, useRef, useEffect } from 'react';
import { Audio } from 'expo-av';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

export interface UseAudioRecorderReturn {
  audioLevel: SharedValue<number>;
  audioLevelRef: React.MutableRefObject<number>;
  setAudioLevel: (level: number) => void;
  isRecording: boolean;
  startMeetingRecording: () => Promise<boolean>;
  stopMeetingRecording: () => Promise<string | null>;
  requestPermissions: () => Promise<boolean>;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const audioLevel = useSharedValue<number>(0);
  const audioLevelRef = useRef<number>(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const setAudioLevel = useCallback((level: number) => {
    const normalized = Math.min(1, Math.max(0, level));
    audioLevelRef.current = normalized;
    audioLevel.value = normalized;
  }, [audioLevel]);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      return permission.granted;
    } catch (err) {
      console.error('[AudioRecorder] Failed to request permissions:', err);
      return false;
    }
  }, []);

  // Update audio level from metering if recording is active
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isRecording && recordingRef.current) {
      interval = setInterval(async () => {
        try {
          if (recordingRef.current) {
            const status = await recordingRef.current.getStatusAsync();
            if (status.isRecording && status.metering !== undefined) {
              // status.metering is a dB value from -160 to 0. Map to 0-1.
              // -160 is silence, 0 is max volume
              const db = status.metering;
              const normalized = Math.min(1, Math.max(0, (db + 160) / 160));
              setAudioLevel(normalized);
            }
          }
        } catch (e) {
          // ignore status read errors during teardown
        }
      }, 100);
    } else {
      setAudioLevel(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording, setAudioLevel]);

  const startMeetingRecording = useCallback(async (): Promise<boolean> => {
    try {
      const granted = await requestPermissions();
      if (!granted) {
        return false;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Enable metering in high quality options
      const recordingOptions = {
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        android: {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
          meteringEnabled: true,
        },
        ios: {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
          meteringEnabled: true,
        },
      };

      const { recording } = await Audio.Recording.createAsync(
        recordingOptions
      );

      recordingRef.current = recording;
      setIsRecording(true);
      return true;
    } catch (err) {
      console.error('[AudioRecorder] Failed to start meeting recording:', err);
      setIsRecording(false);
      return false;
    }
  }, [requestPermissions]);

  const stopMeetingRecording = useCallback(async (): Promise<string | null> => {
    if (!recordingRef.current) return null;
    try {
      const recording = recordingRef.current;
      recordingRef.current = null;
      setIsRecording(false);

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      return uri;
    } catch (err) {
      console.error('[AudioRecorder] Failed to stop meeting recording:', err);
      setIsRecording(false);
      return null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  return {
    audioLevel,
    audioLevelRef,
    setAudioLevel,
    isRecording,
    startMeetingRecording,
    stopMeetingRecording,
    requestPermissions,
  };
}

export default useAudioRecorder;
