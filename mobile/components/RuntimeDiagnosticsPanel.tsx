import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import type { RuntimeGuardianState } from '../hooks/useRuntimeGuardian';

interface Props {
  guardian: RuntimeGuardianState;
}

export function RuntimeDiagnosticsPanel({ guardian }: Props) {
  const [expanded, setExpanded] = useState(false);

  // This is DEV-only. In production, return null.
  if (!__DEV__) {
    return null;
  }

  const { mode, snapshot, warningHistory, throttles } = guardian;
  
  const getModeColor = (m: string) => {
    switch (m) {
      case 'healthy': return '#4ade80';
      case 'degraded': return '#facc15';
      case 'recovering': return '#60a5fa';
      case 'safe_mode': return '#f87171';
      default: return '#9ca3af';
    }
  };

  if (!expanded) {
    return (
      <View style={styles.collapsedContainer}>
        <TouchableOpacity style={styles.collapsedButton} onPress={() => setExpanded(true)}>
          <View style={[styles.statusDot, { backgroundColor: getModeColor(mode) }]} />
          <Text style={styles.collapsedText}>
            Guardian: {mode} (Score: {snapshot.stabilityScore})
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.expandedContainer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Runtime Diagnostics</Text>
        <TouchableOpacity onPress={() => setExpanded(false)} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>Collapse</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollContent} nestedScrollEnabled={true}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Guardian State</Text>
          <Text style={styles.textRow}>Mode: <Text style={{ color: getModeColor(mode), fontWeight: 'bold' }}>{mode}</Text></Text>
          <Text style={styles.textRow}>Stability: {snapshot.stabilityScore}/100</Text>
          <Text style={styles.textRow}>Memory Health: {snapshot.memoryHealthScore}/100</Text>
          <Text style={styles.textRow}>Performance: {snapshot.performanceHealthScore}/100</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Throttles Active</Text>
          <Text style={styles.textRow}>Pause Streaming: {throttles.shouldPauseStreaming ? 'YES' : 'NO'}</Text>
          <Text style={styles.textRow}>Throttle Proactive: {throttles.shouldThrottleProactive ? 'YES' : 'NO'}</Text>
          <Text style={styles.textRow}>Defer Sync: {throttles.shouldDeferBackgroundSync ? 'YES' : 'NO'}</Text>
          <Text style={styles.textRow}>Pause Mic: {throttles.shouldPauseMicrophone ? 'YES' : 'NO'}</Text>
          <Text style={styles.textRow}>Subsystems: {snapshot.throttledSystems.join(', ') || 'None'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Anomalies ({snapshot.anomalies.length})</Text>
          {snapshot.anomalies.length === 0 ? (
            <Text style={styles.textRow}>None</Text>
          ) : (
            snapshot.anomalies.map((a, i) => <Text key={i} style={styles.errorText}>• {a}</Text>)
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Warnings ({snapshot.warnings.length})</Text>
          {snapshot.warnings.length === 0 ? (
            <Text style={styles.textRow}>None</Text>
          ) : (
            snapshot.warnings.map((w, i) => <Text key={i} style={styles.warningText}>• {w}</Text>)
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Warning History ({warningHistory.length})</Text>
          {warningHistory.length === 0 ? (
            <Text style={styles.textRow}>None</Text>
          ) : (
            warningHistory.slice(-5).map((w, i) => <Text key={i} style={styles.mutedText}>• {w}</Text>)
          )}
        </View>
        
        <TouchableOpacity style={styles.actionBtn} onPress={guardian.recoverSubsystems}>
          <Text style={styles.actionBtnText}>Force Recovery</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  collapsedContainer: {
    position: 'absolute',
    bottom: 90,
    right: 20,
    zIndex: 999,
  },
  collapsedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#374151',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  collapsedText: {
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '500',
  },
  expandedContainer: {
    position: 'absolute',
    bottom: 90,
    left: 20,
    right: 20,
    maxHeight: 400,
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#374151',
    zIndex: 999,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  headerTitle: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: 'bold',
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  textRow: {
    color: '#e5e7eb',
    fontSize: 13,
    marginBottom: 4,
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    marginBottom: 4,
  },
  warningText: {
    color: '#facc15',
    fontSize: 13,
    marginBottom: 4,
  },
  mutedText: {
    color: '#9ca3af',
    fontSize: 12,
    marginBottom: 4,
  },
  actionBtn: {
    backgroundColor: '#374151',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  actionBtnText: {
    color: '#f9fafb',
    fontWeight: '600',
  }
});
