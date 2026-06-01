import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { GlassCard } from './GlassCard';
import { Users, FileText } from 'lucide-react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { ParticipantChip } from './ParticipantChip';

interface MeetingSummaryCardProps {
  summary: string;
  participants: string[];
}

export function MeetingSummaryCard({ summary, participants }: MeetingSummaryCardProps) {
  if (!summary && (!participants || participants.length === 0)) return null;

  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.container}>
      <GlassCard intensity={25} tint="dark" style={styles.card}>
        <View style={styles.header}>
          <FileText size={18} color="#60a5fa" />
          <Text style={styles.title}>Meeting Summary</Text>
        </View>

        {!!(participants && participants.length > 0) && (
          <View style={styles.participantsContainer}>
            <View style={styles.participantsHeader}>
              <Users size={14} color="#94a3b8" />
              <Text style={styles.participantsTitle}>Participants</Text>
            </View>
            <View style={styles.chipRow}>
              {participants.map((p, i) => (
                <ParticipantChip key={i} name={p} />
              ))}
            </View>
          </View>
        )}

        {summary ? (
          <Text style={styles.summaryText}>{summary}</Text>
        ) : null}
      </GlassCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  card: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.1)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    color: '#60a5fa',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
    letterSpacing: 0,
  },
  participantsContainer: {
    marginBottom: 12,
  },
  participantsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  participantsTitle: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  summaryText: {
    color: '#f8fafc',
    fontSize: 15,
    lineHeight: 24,
  },
});
