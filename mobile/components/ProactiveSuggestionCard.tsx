import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';
import { GlassCard } from './GlassCard';
import { 
  CalendarClock, 
  MessageCircle, 
  Clock, 
  FolderSync,
  AlertTriangle,
  Users,
  X
} from 'lucide-react-native';
import type { ProactiveSignal } from '../hooks/useProactiveAssistant';

export interface ProactiveSuggestionCardProps {
  signal: ProactiveSignal;
  onPress: (signal: ProactiveSignal) => void;
  onDismiss: (signal: ProactiveSignal) => void;
  index: number;
}

export function ProactiveSuggestionCard({
  signal,
  onPress,
  onDismiss,
  index
}: ProactiveSuggestionCardProps) {
  const Icon = useMemo(() => {
    switch (signal.signalType) {
      case 'overdue_reminder':
        return AlertTriangle;
      case 'deadline_warning':
        return Clock;
      case 'continuation_prompt':
      case 'recurring_topic':
        return MessageCircle;
      case 'project_followup':
      case 'unresolved_task':
        return FolderSync;
      case 'collaborator_followup':
        return Users;
      default:
        return CalendarClock;
    }
  }, [signal.signalType]);

  const color = signal.signalType === 'overdue_reminder' ? '#ef4444' : '#4af8e3';

  return (
    <Animated.View 
      entering={FadeInUp.delay(index * 150).springify().damping(16).stiffness(120)}
      exiting={FadeOutDown.duration(200)}
      style={styles.container}
    >
      <TouchableOpacity activeOpacity={0.8} onPress={() => onPress(signal)}>
        <GlassCard intensity={30} tint="dark" style={styles.card}>
          <View style={styles.content}>
            <View style={[styles.iconWrapper, { backgroundColor: `${color}15` }]}>
              <Icon color={color} size={16} />
            </View>
            <View style={styles.textWrapper}>
              <Text style={styles.title} numberOfLines={1}>{signal.title}</Text>
              <Text style={styles.description} numberOfLines={2}>{signal.description}</Text>
            </View>
            <TouchableOpacity 
              hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
              onPress={(e) => { e.stopPropagation(); onDismiss(signal); }}
              style={styles.dismissBtn}
            >
              <X color="#acaab0" size={16} />
            </TouchableOpacity>
          </View>
        </GlassCard>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 6,
    width: '100%',
  },
  card: {
    padding: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.02)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrapper: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    color: '#fcf8fe',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  description: {
    color: '#acaab0',
    fontSize: 12,
    lineHeight: 16,
  },
  dismissBtn: {
    padding: 4,
    opacity: 0.7,
  }
});
