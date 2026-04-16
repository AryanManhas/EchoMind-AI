import { useState, useEffect, useCallback } from 'react';
import Voice, { 
  SpeechResultsEvent, 
  SpeechErrorEvent, 
  SpeechVolumeChangeEvent 
} from '@react-native-voice/voice';
import { PermissionsAndroid, Platform } from 'react-native';

export interface VoiceState {
  isRecording: boolean;
  sentences: string[];
  partialTranscript: string;
  audioLevel: number; // 0.0 to 1.0
  error: string | null;
}

export const useEchoMindVoice = () => {
  const [state, setState] = useState<VoiceState>({
    isRecording: false,
    sentences: [],
    partialTranscript: '',
    audioLevel: 0,
    error: null,
  });

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          // Bluetooth permissions handled at manifest level, but some require check
        ]);
        return granted['android.permission.RECORD_AUDIO'] === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        console.warn(err);
        return false;
      }
    }
    return true;
  };

  const onSpeechStart = () => setState(s => ({ ...s, isRecording: true, error: null }));
  const onSpeechEnd = () => setState(s => ({ ...s, isRecording: false }));
  
  const onSpeechResults = (e: SpeechResultsEvent) => {
    if (e.value && e.value.length > 0) {
      const result = e.value[0];
      setState(s => ({
        ...s,
        sentences: [...s.sentences, result],
        partialTranscript: '',
      }));
    }
  };

  const onSpeechPartialResults = (e: SpeechResultsEvent) => {
    if (e.value && e.value.length > 0) {
      setState(s => ({ ...s, partialTranscript: e.value![0] }));
    }
  };

  const onSpeechError = (e: SpeechErrorEvent) => {
    setState(s => ({ ...s, error: e.error?.message || 'STT Error', isRecording: false }));
  };

  const onSpeechVolumeChanged = (e: SpeechVolumeChangeEvent) => {
    // Normalize volume (0 to 10 typical, map to 0-1)
    const normalized = Math.min(1, Math.max(0, (e.value || 0) / 10));
    setState(s => ({ ...s, audioLevel: normalized }));
  };

  useEffect(() => {
    Voice.onSpeechStart = onSpeechStart;
    Voice.onSpeechEnd = onSpeechEnd;
    Voice.onSpeechResults = onSpeechResults;
    Voice.onSpeechPartialResults = onSpeechPartialResults;
    Voice.onSpeechError = onSpeechError;
    Voice.onSpeechVolumeChanged = onSpeechVolumeChanged;

    return () => {
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, []);

  const startRecording = useCallback(async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) {
      setState(s => ({ ...s, error: 'Mic Permission Denied' }));
      return;
    }

    try {
      await Voice.start('en-US');
    } catch (e: any) {
      setState(s => ({ ...s, error: e.message }));
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      await Voice.stop();
    } catch (e: any) {
      setState(s => ({ ...s, error: e.message }));
    }
  }, []);

  return {
    ...state,
    startRecording,
    stopRecording,
  };
};

export default useEchoMindVoice;

