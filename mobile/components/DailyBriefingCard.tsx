import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { X, Calendar, CheckSquare, Bell, Sparkles } from 'lucide-react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { GlassCard } from './GlassCard';
import type { BriefingData } from '../hooks/useDailyBriefing';

interface DailyBriefingCardProps {
  briefing: BriefingData;
  onDismiss: () => void;
}

export function DailyBriefingCard({ briefing, onDismiss }: DailyBriefingCardProps) {
  if (!briefing.isActive) return null;

  return (
    <Animated.View entering={FadeInUp.springify()} exiting={FadeOutUp}>
      <GlassCard style={styles.card}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Sparkles color="#c799ff" size={20} />
            <Text style={styles.greeting}>{briefing.greeting}</Text>
          </View>
          <TouchableOpacity onPress={onDismiss} style={styles.closeButton}>
            <X color="#acaab0" size={20} />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          {briefing.meetings.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Calendar color="#4af8e3" size={14} />
                <Text style={styles.sectionTitle}>Meetings</Text>
              </View>
              {briefing.meetings.map((meeting, idx) => (
                <Text key={`meeting-${idx}`} style={styles.itemText} numberOfLines={1}>
                  • {meeting.title}
                </Text>
              ))}
            </View>
          )}

          {briefing.unresolvedTasks.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <CheckSquare color="#f472b6" size={14} />
                <Text style={styles.sectionTitle}>Pending Tasks</Text>
              </View>
              {briefing.unresolvedTasks.map((task, idx) => (
                <Text key={`task-${idx}`} style={styles.itemText} numberOfLines={2}>
                  • {task}
                </Text>
              ))}
            </View>
          )}

          {briefing.reminders.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Bell color="#fbbf24" size={14} />
                <Text style={styles.sectionTitle}>Active Reminders</Text>
              </View>
              {briefing.reminders.map((reminder, idx) => (
                <Text key={`reminder-${idx}`} style={styles.itemText} numberOfLines={2}>
                  • {reminder.title}
                </Text>
              ))}
            </View>
          )}
          
          {!!(briefing.meetings.length === 0 && briefing.unresolvedTasks.length === 0 && briefing.reminders.length === 0) && (
             <Text style={styles.emptyText}>You're all caught up for the day!</Text>
          )}
        </View>
      </GlassCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 24,
    marginBottom: 24,
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(199, 153, 255, 0.05)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 12,
  },
  greeting: {
    color: '#fcf8fe',
    fontSize: 18,
    fontWeight: '600',
    flexShrink: 1,
  },
  closeButton: {
    padding: 4,
  },
  content: {
    gap: 16,
  },
  section: {
    gap: 6,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  sectionTitle: {
    color: '#acaab0',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  itemText: {
    color: '#e2e0e5',
    fontSize: 14,
    lineHeight: 20,
    paddingLeft: 4,
  },
  emptyText: {
    color: '#acaab0',
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8,
  }
});
