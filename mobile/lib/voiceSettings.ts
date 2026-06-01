/**
 * Voice Capture Settings — Persistent configuration for EchoMind voice system.
 * Includes bilingual (English + Hindi) configuration.
 * Uses in-memory cache with TODO for AsyncStorage persistence.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ──────────────────────────────────────────────────────

export type SensitivityLevel = 'low' | 'medium' | 'high';
export type LanguageMode = 'en' | 'hi' | 'auto';

export interface VoiceSettings {
  /** Speech detection sensitivity */
  sensitivity: SensitivityLevel;
  /** Silence timeout before auto-stop (ms) */
  silenceTimeoutMs: number;
  /** Auto voice detection mode enabled */
  autoModeEnabled: boolean;
  /** Haptic/vibration feedback on state changes */
  vibrationFeedback: boolean;
  /** Language mode for STT */
  languageMode: LanguageMode;
  /** Whether to show real-time language indicator */
  showLanguageIndicator: boolean;
  /** Privacy: require wake-word for passive mode */
  requireWakeWord: boolean;
  /** Privacy: consent for passive listening given */
  passiveListeningConsent: boolean;
}

// ─── Defaults ───────────────────────────────────────────────────

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  sensitivity: 'medium',
  silenceTimeoutMs: 2000,
  autoModeEnabled: false,
  vibrationFeedback: true,
  languageMode: 'auto',
  showLanguageIndicator: true,
  requireWakeWord: true,
  passiveListeningConsent: false,
};

// ─── Sensitivity Thresholds ─────────────────────────────────────
// These map sensitivity levels to volumechange thresholds (normalized 0-1).
// expo-speech-recognition volumechange values are typically -2 to 10 on Android.

export const SENSITIVITY_THRESHOLDS: Record<SensitivityLevel, number> = {
  high: 0.02,   // Extremely sensitive — picks up whisper/very quiet speech
  medium: 0.08, // Balanced/Premium — captures soft spoken and ambient speech easily
  low: 0.20,    // Conservative — normal to loud speaking volume
};

// ─── Silence Timeout Presets ────────────────────────────────────

export const SILENCE_TIMEOUT_OPTIONS = [
  { label: '1.5s', value: 1500 },
  { label: '2s', value: 2000 },
  { label: '3s', value: 3000 },
  { label: '5s', value: 5000 },
];

// ─── Language Presets ───────────────────────────────────────────

export const LANGUAGE_MODE_OPTIONS: { label: string; value: LanguageMode; flag: string }[] = [
  { label: 'English', value: 'en', flag: '🇺🇸' },
  { label: 'Hindi', value: 'hi', flag: '🇮🇳' },
  { label: 'Auto (Bilingual)', value: 'auto', flag: '🌐' },
];

// ─── STT Locale Mapping ────────────────────────────────────────

export function getSTTLocale(mode: LanguageMode): string {
  switch (mode) {
    case 'hi': return 'hi-IN';
    case 'en': return 'en-US';
    case 'auto': return 'en-US'; // Start with English, switch if Hindi detected
    default: return 'en-US';
  }
}

// ─── Storage Keys ───────────────────────────────────────────────

const STORAGE_KEY = '@echomind_voice_settings';

// ─── Simple In-Memory Cache ─────────────────────────────────────

let _cachedSettings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };
let _initialized = false;

/**
 * Initialize settings from AsyncStorage on app startup.
 */
export async function initVoiceSettings(): Promise<void> {
  if (_initialized) return;
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    if (json) {
      _cachedSettings = { ...DEFAULT_VOICE_SETTINGS, ...JSON.parse(json) };
    }
  } catch (error) {
    console.error('Failed to load voice settings:', error);
  } finally {
    _initialized = true;
  }
}

/**
 * Load settings. 
 * Reads synchronously from cache.
 */
export function getVoiceSettings(): VoiceSettings {
  return { ..._cachedSettings };
}

/**
 * Update voice settings and persist to AsyncStorage.
 */
export function updateVoiceSettings(partial: Partial<VoiceSettings>): VoiceSettings {
  _cachedSettings = { ..._cachedSettings, ...partial };
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(_cachedSettings)).catch(err => {
    console.error('Failed to save voice settings:', err);
  });
  return { ..._cachedSettings };
}

/**
 * Reset to defaults and clear from storage.
 */
export function resetVoiceSettings(): VoiceSettings {
  _cachedSettings = { ...DEFAULT_VOICE_SETTINGS };
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(_cachedSettings)).catch(err => {
    console.error('Failed to save voice settings:', err);
  });
  return { ..._cachedSettings };
}

/**
 * Get the speech detection threshold for current sensitivity.
 */
export function getCurrentThreshold(): number {
  return SENSITIVITY_THRESHOLDS[_cachedSettings.sensitivity];
}

/**
 * Check if passive listening is allowed (user consent + settings).
 */
export function isPassiveListeningAllowed(): boolean {
  return _cachedSettings.passiveListeningConsent;
}