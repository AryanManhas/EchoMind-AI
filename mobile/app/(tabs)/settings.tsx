import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Linking,
  Platform,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Settings as SettingsIcon,
  Mic,
  Bell,
  Zap,
  Shield,
  Globe,
  Volume2,
  Clock,
  Trash2,
  Info,
  ChevronRight,
  Activity,
  Wifi,
  WifiOff,
  Brain,
  Radio,
  HardDrive,
  RefreshCw,
} from 'lucide-react-native';
import {
  getVoiceSettings,
  updateVoiceSettings,
  resetVoiceSettings,
  LANGUAGE_MODE_OPTIONS,
  SILENCE_TIMEOUT_OPTIONS,
  type VoiceSettings,
  type SensitivityLevel,
  type LanguageMode,
} from '../../lib/voiceSettings';
import { usePersistentMemory } from '../../hooks/usePersistentMemory';
import { useReminderEngine } from '../../hooks/useReminderEngine';
import { useKnowledgeGraph } from '../../hooks/useKnowledgeGraph';
import { useRuntimeHealth } from '../../hooks/useRuntimeHealth';
import { usePresentationMode } from '../../hooks/usePresentationMode';
import { EchoMindSocket } from '../../lib/socket';


const { width } = Dimensions.get('window');

// ─── Diagnostics Panel ──────────────────────────────────────────────────────
function DiagnosticsPanel() {
  const { memories, isLoaded: memLoaded } = usePersistentMemory();
  const { tasks, isLoaded: tasksLoaded, diagnostics: reminderDiagnostics } = useReminderEngine(memories);
  const [socketStatus, setSocketStatus] = useState<'connected' | 'connecting' | 'local_mode' | 'suspended'>('local_mode');
  const knowledgeGraph = useKnowledgeGraph({
    query: '',
    memories,
    reminders: tasks,
    limits: {
      maxContextCharacters: 360,
      maxProjects: 4,
      maxParticipants: 5,
      maxTopics: 6,
    },
  });
  const runtimeHealth = useRuntimeHealth({
    memories,
    reminders: tasks,
    knowledgeGraph,
    promptSections: [knowledgeGraph.contextText],
    websocketMetrics: EchoMindSocket.getInstance().getMetrics(),
    lifecycleState: socketStatus,
    storageRecoveryWarning: memories.length > 0 && memLoaded && memories.length >= 180
      ? 'Memory vault is at restoration bounds.'
      : null,
    notificationHealth: tasksLoaded
      ? `Reminder notifications restored: ${reminderDiagnostics.scheduledNotificationCount}`
      : null,
    renderKey: `${socketStatus}:${memories.length}:${tasks.length}`,
    sampleIntervalMs: 2400,
  });

  useEffect(() => {
    const socket = EchoMindSocket.getInstance();
    const onConnected = () => setSocketStatus('connected');
    const onConnecting = () => setSocketStatus('connecting');
    const onLocalMode = () => setSocketStatus('local_mode');
    const onSuspended = () => setSocketStatus('suspended');

    socket.on('connected', onConnected);
    socket.on('connecting', onConnecting);
    socket.on('local_mode', onLocalMode);
    socket.on('suspended', onSuspended);

    return () => {
      socket.off('connected', onConnected);
      socket.off('connecting', onConnecting);
      socket.off('local_mode', onLocalMode);
      socket.off('suspended', onSuspended);
    };
  }, []);

  const socketColor =
    socketStatus === 'connected' ? '#4af8e3' :
    socketStatus === 'connecting' ? '#fbbf24' : '#acaab0';

  const pendingTasks = tasks.filter(t => t.state === 'pending' || t.state === 'scheduled' || t.state === 'triggered');
  const completedTasks = tasks.filter(t => t.state === 'completed');

  return (
    <View style={diagStyles.container}>
      <Text style={diagStyles.sectionHeader}>SYSTEM DIAGNOSTICS</Text>

      {/* Socket Status */}
      <View style={diagStyles.row}>
        <View style={diagStyles.rowLeft}>
          <Wifi color={socketColor} size={16} />
          <Text style={diagStyles.rowLabel}>WebSocket</Text>
        </View>
        <View style={[diagStyles.statusPill, { borderColor: socketColor + '40' }]}>
          <View style={[diagStyles.statusDot, { backgroundColor: socketColor }]} />
          <Text style={[diagStyles.statusText, { color: socketColor }]}>
            {socketStatus === 'local_mode' ? 'LOCAL MODE' : socketStatus === 'suspended' ? 'SUSPENDED' : socketStatus.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Memory Stats */}
      <View style={diagStyles.row}>
        <View style={diagStyles.rowLeft}>
          <Brain color="#c799ff" size={16} />
          <Text style={diagStyles.rowLabel}>Local Memories</Text>
        </View>
        <Text style={diagStyles.rowValue}>
          {memLoaded ? `${memories.length} stored` : 'Loading…'}
        </Text>
      </View>

      {/* Tasks Stats */}
      <View style={diagStyles.row}>
        <View style={diagStyles.rowLeft}>
          <Activity color="#4af8e3" size={16} />
          <Text style={diagStyles.rowLabel}>Active Tasks</Text>
        </View>
        <Text style={diagStyles.rowValue}>
          {tasksLoaded ? `${pendingTasks.length} pending · ${completedTasks.length} done` : 'Loading…'}
        </Text>
      </View>

      {/* Runtime */}
      <View style={diagStyles.row}>
        <View style={diagStyles.rowLeft}>
          <HardDrive color="rgba(252,248,254,0.5)" size={16} />
          <Text style={diagStyles.rowLabel}>Runtime Health</Text>
        </View>
        <Text style={diagStyles.rowValue}>
          M{runtimeHealth.snapshot.memoryHealthScore} P{runtimeHealth.snapshot.promptHealthScore} S{runtimeHealth.snapshot.stabilityScore}
        </Text>
      </View>

      <View style={diagStyles.row}>
        <View style={diagStyles.rowLeft}>
          <Radio color="rgba(252,248,254,0.5)" size={16} />
          <Text style={diagStyles.rowLabel}>Prompt / Graph</Text>
        </View>
        <Text style={diagStyles.rowValue}>
          {runtimeHealth.snapshot.promptTokenEstimate} tok · {runtimeHealth.snapshot.graphEntityCount}/{runtimeHealth.snapshot.graphRelationshipCount}
        </Text>
      </View>

      <View style={diagStyles.row}>
        <View style={diagStyles.rowLeft}>
          <RefreshCw color="rgba(252,248,254,0.5)" size={16} />
          <Text style={diagStyles.rowLabel}>Reconnects / Queue</Text>
        </View>
        <Text style={diagStyles.rowValue}>
          {runtimeHealth.snapshot.websocketReconnectCount} · {runtimeHealth.snapshot.syncQueueSize}
        </Text>
      </View>

      {!!(runtimeHealth.snapshot.warnings.length > 0 || runtimeHealth.snapshot.anomalies.length > 0) && (
        <Text style={diagStyles.warningText}>
          {[...runtimeHealth.snapshot.anomalies, ...runtimeHealth.snapshot.warnings].slice(0, 3).join('\n')}
        </Text>
      )}

      {/* Runtime */}
      <View style={diagStyles.row}>
        <View style={diagStyles.rowLeft}>
          <HardDrive color="rgba(252,248,254,0.5)" size={16} />
          <Text style={diagStyles.rowLabel}>Runtime</Text>
        </View>
        <Text style={diagStyles.rowValue}>Hermes · React 18 · RN 0.74</Text>
      </View>

      {/* Platform */}
      <View style={diagStyles.row}>
        <View style={diagStyles.rowLeft}>
          <Radio color="rgba(252,248,254,0.5)" size={16} />
          <Text style={diagStyles.rowLabel}>Platform</Text>
        </View>
        <Text style={diagStyles.rowValue}>{Platform.OS} {Platform.Version}</Text>
      </View>
    </View>
  );
}

const diagStyles = StyleSheet.create({
  container: {
    marginTop: 8,
    marginHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
    padding: 18,
    gap: 14,
  },
  sectionHeader: {
    fontSize: 10,
    fontWeight: '800',
    color: '#4af8e3',
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowLabel: {
    color: 'rgba(252,248,254,0.7)',
    fontSize: 13,
    fontWeight: '600',
  },
  rowValue: {
    color: 'rgba(252,248,254,0.4)',
    fontSize: 12,
    fontWeight: '500',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  warningText: {
    color: 'rgba(251,191,36,0.78)',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
});

// ─── Settings Row Components ────────────────────────────────────────────────

function SettingsRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={rowStyles.container}
      activeOpacity={onPress ? 0.7 : 1}
      onPress={onPress}
    >
      <View style={rowStyles.left}>
        {icon}
        <Text style={rowStyles.label}>{label}</Text>
      </View>
      <View style={rowStyles.right}>
        {value !== undefined && <Text style={rowStyles.value}>{value}</Text>}
        {!!onPress && <ChevronRight color="rgba(252,248,254,0.2)" size={16} />}
      </View>
    </TouchableOpacity>
  );
}

function SettingsToggleRow({
  icon,
  label,
  value,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  value: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <View style={rowStyles.container}>
      <View style={rowStyles.left}>
        {icon}
        <Text style={rowStyles.label}>{label}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: 'rgba(255,255,255,0.1)', true: 'rgba(199,153,255,0.4)' }}
        thumbColor={value ? '#c799ff' : 'rgba(252,248,254,0.6)'}
      />
    </View>
  );
}

const rowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    color: '#fcf8fe',
    fontSize: 15,
    fontWeight: '600',
  },
  value: {
    color: 'rgba(252,248,254,0.4)',
    fontSize: 13,
    fontWeight: '500',
  },
});

// ─── Main Settings Screen ───────────────────────────────────────────────────

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<VoiceSettings>(getVoiceSettings);
  const { clearMemory } = usePersistentMemory();
  const { clearTasks } = useReminderEngine();
  const { isPresentationMode } = usePresentationMode();

  const update = useCallback((partial: Partial<VoiceSettings>) => {
    const updated = updateVoiceSettings(partial);
    setSettings(updated);
  }, []);

  const handleLanguageCycle = () => {
    const modes: LanguageMode[] = ['en', 'hi', 'auto'];
    const currentIdx = modes.indexOf(settings.languageMode);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    update({ languageMode: nextMode });
  };

  const handleSensitivityCycle = () => {
    const levels: SensitivityLevel[] = ['low', 'medium', 'high'];
    const currentIdx = levels.indexOf(settings.sensitivity);
    const nextLevel = levels[(currentIdx + 1) % levels.length];
    update({ sensitivity: nextLevel });
  };

  const handleSilenceCycle = () => {
    const values = SILENCE_TIMEOUT_OPTIONS.map(o => o.value);
    const currentIdx = values.indexOf(settings.silenceTimeoutMs);
    const nextValue = values[(currentIdx + 1) % values.length];
    update({ silenceTimeoutMs: nextValue });
  };

  const getSilenceLabel = () => {
    const opt = SILENCE_TIMEOUT_OPTIONS.find(o => o.value === settings.silenceTimeoutMs);
    return opt?.label || `${settings.silenceTimeoutMs}ms`;
  };

  const getLanguageLabel = () => {
    const opt = LANGUAGE_MODE_OPTIONS.find(o => o.value === settings.languageMode);
    return opt ? `${opt.flag} ${opt.label}` : settings.languageMode;
  };

  const handleClearAllData = () => {
    Alert.alert(
      'Clear All Local Data',
      'This permanently deletes ALL local memories, tasks, and settings. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: async () => {
            await clearMemory();
            await clearTasks();
            resetVoiceSettings();
            setSettings(getVoiceSettings());
            Alert.alert('Cleared', 'All local data has been erased.');
          },
        },
      ]
    );
  };

  const handleResetOnboarding = async () => {
    await AsyncStorage.removeItem('@EchoMind:OnboardingCompleted');
    Alert.alert('Onboarding Reset', 'Restart the app to see the onboarding flow again.');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <LinearGradient
        colors={['rgba(199,153,255,0.04)', 'rgba(74,248,227,0.02)', 'transparent']}
        style={styles.bgGradient}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.pageTitle}>Settings</Text>
          <Text style={styles.subtitle}>Make EchoMind feel right for you.</Text>
        </View>

        {/* Voice Configuration Section */}
        <Text style={styles.sectionTitle}>VOICE</Text>
        <View style={styles.section}>
          <SettingsRow
            icon={<Globe color="#c799ff" size={20} />}
            label="Language"
            value={getLanguageLabel()}
            onPress={handleLanguageCycle}
          />
          <View style={styles.divider} />
          <SettingsRow
            icon={<Volume2 color="#c799ff" size={20} />}
            label="Sensitivity"
            value={settings.sensitivity.charAt(0).toUpperCase() + settings.sensitivity.slice(1)}
            onPress={handleSensitivityCycle}
          />
          <View style={styles.divider} />
          <SettingsRow
            icon={<Clock color="#c799ff" size={20} />}
            label="Pause Before Saving"
            value={getSilenceLabel()}
            onPress={handleSilenceCycle}
          />
        </View>

        {/* Behavior Section */}
        <Text style={styles.sectionTitle}>LISTENING</Text>
        <View style={styles.section}>
          <SettingsToggleRow
            icon={<Mic color="#4af8e3" size={20} />}
            label="Listen Automatically"
            value={settings.autoModeEnabled}
            onToggle={(v) => update({ autoModeEnabled: v })}
          />
          <View style={styles.divider} />
          <SettingsToggleRow
            icon={<Zap color="#fbbf24" size={20} />}
            label="Gentle Haptics"
            value={settings.vibrationFeedback}
            onToggle={(v) => update({ vibrationFeedback: v })}
          />
          <View style={styles.divider} />
          <SettingsToggleRow
            icon={<Shield color="#4af8e3" size={20} />}
            label="Wake Word"
            value={settings.requireWakeWord}
            onToggle={(v) => update({ requireWakeWord: v })}
          />
          <View style={styles.divider} />
          <SettingsToggleRow
            icon={<Globe color="rgba(252,248,254,0.5)" size={20} />}
            label="Show Language"
            value={settings.showLanguageIndicator}
            onToggle={(v) => update({ showLanguageIndicator: v })}
          />
        </View>

        {/* Diagnostics */}
        {!!(__DEV__ && !isPresentationMode) && (
          <>
            <Text style={styles.sectionTitle}>RUNTIME STATUS</Text>
            <DiagnosticsPanel />
          </>
        )}

        {/* Data Management Section */}
        <Text style={styles.sectionTitle}>PRIVACY & DATA</Text>
        <View style={styles.section}>
          <SettingsRow
            icon={<RefreshCw color="rgba(252,248,254,0.5)" size={20} />}
            label="Replay Welcome"
            onPress={handleResetOnboarding}
          />
          <View style={styles.divider} />
          <TouchableOpacity
            style={rowStyles.container}
            activeOpacity={0.7}
            onPress={handleClearAllData}
          >
            <View style={rowStyles.left}>
              <Trash2 color="#ef4444" size={20} />
              <Text style={[rowStyles.label, { color: '#fca5a5' }]}>Erase Local Data</Text>
            </View>
            <ChevronRight color="rgba(239,68,68,0.4)" size={16} />
          </TouchableOpacity>
        </View>

        {/* App Info Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>EchoMind AI · v0.0.1</Text>
          <Text style={styles.footerSubtext}>Local-first conversational intelligence</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111115',
  },
  bgGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  scrollContent: {
    paddingTop: 20,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 28,
  },
  pageTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: '#fcf8fe',
    letterSpacing: 0,
  },
  subtitle: {
    color: 'rgba(252,248,254,0.4)',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 4,
  },
  sectionTitle: {
    color: 'rgba(252,248,254,0.35)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.9,
    paddingHorizontal: 20,
    marginTop: 24,
    marginBottom: 10,
  },
  section: {
    marginHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
    marginHorizontal: 18,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 4,
  },
  footerText: {
    color: 'rgba(252,248,254,0.25)',
    fontSize: 12,
    fontWeight: '700',
  },
  footerSubtext: {
    color: 'rgba(252,248,254,0.15)',
    fontSize: 11,
    fontWeight: '500',
  },
});
