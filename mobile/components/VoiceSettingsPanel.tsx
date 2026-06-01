import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, ScrollView } from 'react-native';
import { BlurView } from 'expo-blur';
import { 
  getVoiceSettings, 
  updateVoiceSettings, 
  type VoiceSettings, 
  type SensitivityLevel,
  SILENCE_TIMEOUT_OPTIONS,
  LANGUAGE_MODE_OPTIONS
} from '../lib/voiceSettings';
import { Settings, Volume2, Timer, Zap, BellRing, X, Globe, Shield, Mic } from 'lucide-react-native';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';

interface VoiceSettingsPanelProps {
  onClose: () => void;
  onSettingsChanged?: (settings: VoiceSettings) => void;
}

export function VoiceSettingsPanel({ onClose, onSettingsChanged }: VoiceSettingsPanelProps) {
  const [settings, setSettings] = useState<VoiceSettings>(getVoiceSettings());

  const handleUpdate = (partial: Partial<VoiceSettings>) => {
    const newSettings = updateVoiceSettings(partial);
    setSettings(newSettings);
    if (onSettingsChanged) onSettingsChanged(newSettings);
  };

  const sensitivities: { label: string; value: SensitivityLevel }[] = [
    { label: 'Low', value: 'low' },
    { label: 'Med', value: 'medium' },
    { label: 'High', value: 'high' },
  ];

  return (
    <Animated.View 
      entering={FadeInUp} 
      exiting={FadeOutDown} 
      style={styles.overlay}
    >
      <BlurView intensity={80} tint="dark" style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerTitle}>
            <Settings color="#c799ff" size={20} />
            <Text style={styles.titleText}>Voice Settings</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <X color="#fff" size={20} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {/* Language Mode */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Globe color="#acaab0" size={16} />
              <Text style={styles.sectionTitle}>Language Mode</Text>
            </View>
            <View style={styles.segmentedControl}>
              {LANGUAGE_MODE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => handleUpdate({ languageMode: opt.value })}
                  style={[
                    styles.segment,
                    settings.languageMode === opt.value && styles.segmentActive
                  ]}
                >
                  <Text style={[
                    styles.segmentText,
                    settings.languageMode === opt.value && styles.segmentTextActive
                  ]}>
                    {opt.flag} {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Show Language Indicator */}
          <View style={styles.section}>
            <View style={styles.row}>
              <View style={styles.rowInfo}>
                <Globe color="#acaab0" size={18} />
                <View>
                  <Text style={styles.rowLabel}>Language Indicator</Text>
                  <Text style={styles.rowSublabel}>Show real-time language</Text>
                </View>
              </View>
              <Switch 
                value={settings.showLanguageIndicator}
                onValueChange={(val) => handleUpdate({ showLanguageIndicator: val })}
                trackColor={{ false: '#222', true: '#c799ff' }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* Auto Mode */}
          <View style={styles.section}>
            <View style={styles.row}>
              <View style={styles.rowInfo}>
                <Zap color="#4af8e3" size={18} />
                <View>
                  <Text style={styles.rowLabel}>Auto Voice Detection</Text>
                  <Text style={styles.rowSublabel}>Start recording automatically</Text>
                </View>
              </View>
              <Switch 
                value={settings.autoModeEnabled}
                onValueChange={(val) => handleUpdate({ autoModeEnabled: val })}
                trackColor={{ false: '#222', true: '#c799ff' }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* Sensitivity */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Volume2 color="#acaab0" size={16} />
              <Text style={styles.sectionTitle}>Detection Sensitivity</Text>
            </View>
            <View style={styles.segmentedControl}>
              {sensitivities.map((s) => (
                <TouchableOpacity
                  key={s.value}
                  onPress={() => handleUpdate({ sensitivity: s.value })}
                  style={[
                    styles.segment,
                    settings.sensitivity === s.value && styles.segmentActive
                  ]}
                >
                  <Text style={[
                    styles.segmentText,
                    settings.sensitivity === s.value && styles.segmentTextActive
                  ]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Silence Timeout */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Timer color="#acaab0" size={16} />
              <Text style={styles.sectionTitle}>Silence Timeout</Text>
            </View>
            <View style={styles.segmentedControl}>
              {SILENCE_TIMEOUT_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => handleUpdate({ silenceTimeoutMs: opt.value })}
                  style={[
                    styles.segment,
                    settings.silenceTimeoutMs === opt.value && styles.segmentActive
                  ]}
                >
                  <Text style={[
                    styles.segmentText,
                    settings.silenceTimeoutMs === opt.value && styles.segmentTextActive
                  ]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Privacy Settings */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Shield color="#acaab0" size={16} />
              <Text style={styles.sectionTitle}>Privacy & Permissions</Text>
            </View>
            <View style={styles.row}>
              <View style={styles.rowInfo}>
                <Mic color="#acaab0" size={18} />
                <View>
                  <Text style={styles.rowLabel}>Require Wake Word</Text>
                  <Text style={styles.rowSublabel}>Only listen after "EchoMind"</Text>
                </View>
              </View>
              <Switch 
                value={settings.requireWakeWord}
                onValueChange={(val) => handleUpdate({ requireWakeWord: val })}
                trackColor={{ false: '#222', true: '#c799ff' }}
                thumbColor="#fff"
              />
            </View>
            <View style={[styles.row, { marginTop: 12 }]}>
              <View style={styles.rowInfo}>
                <Shield color="#acaab0" size={18} />
                <View>
                  <Text style={styles.rowLabel}>Passive Listening</Text>
                  <Text style={styles.rowSublabel}>Allow constant background capture</Text>
                </View>
              </View>
              <Switch 
                value={settings.passiveListeningConsent}
                onValueChange={(val) => handleUpdate({ passiveListeningConsent: val })}
                trackColor={{ false: '#222', true: '#c799ff' }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* Haptic Feedback */}
          <View style={styles.section}>
            <View style={styles.row}>
              <View style={styles.rowInfo}>
                <BellRing color="#acaab0" size={18} />
                <View>
                  <Text style={styles.rowLabel}>Haptic Feedback</Text>
                  <Text style={styles.rowSublabel}>Vibrate on state changes</Text>
                </View>
              </View>
              <Switch 
                value={settings.vibrationFeedback}
                onValueChange={(val) => handleUpdate({ vibrationFeedback: val })}
                trackColor={{ false: '#222', true: '#c799ff' }}
                thumbColor="#fff"
              />
            </View>
          </View>
        </ScrollView>
      </BlurView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    zIndex: 1000,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    maxHeight: '80%',
  },
  container: {
    padding: 20,
    backgroundColor: 'rgba(14, 14, 18, 0.85)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  titleText: {
    color: '#fcf8fe',
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    padding: 4,
  },
  scrollContent: {
    gap: 20,
    paddingBottom: 20,
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    color: '#acaab0',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    paddingRight: 12,
  },
  rowLabel: {
    color: '#fcf8fe',
    fontSize: 15,
    fontWeight: '600',
  },
  rowSublabel: {
    color: '#777',
    fontSize: 12,
    marginTop: 2,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentActive: {
    backgroundColor: 'rgba(199, 153, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(199, 153, 255, 0.3)',
  },
  segmentText: {
    color: '#777',
    fontSize: 13,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#c799ff',
  },
});
