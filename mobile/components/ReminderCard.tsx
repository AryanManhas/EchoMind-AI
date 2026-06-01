import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Archive, CalendarClock, CheckCircle, Clock, ExternalLink, Trash2, Users } from 'lucide-react-native';
import { format, isBefore, isToday, isTomorrow, parseISO } from 'date-fns';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { Swipeable } from 'react-native-gesture-handler';
import * as Calendar from 'expo-calendar';

export type ReminderSemanticType = 'reminder' | 'meeting' | 'deadline' | 'overdue' | 'completed';
export type ReminderUrgencyState = 'live' | 'overdue' | 'due_today' | 'upcoming' | 'normal' | 'completed';

interface ReminderCardProps {
  reminder: {
    id: string;
    title: string;
    dueAt: string;
    category: string;
    priority: 'low' | 'medium' | 'high';
    status: string;
    isCritical: boolean;
    sourceSessionId?: string;
    semanticType?: ReminderSemanticType;
    urgencyState?: ReminderUrgencyState;
    participant?: string;
    countdownLabel?: string;
    relativeTiming?: string;
    dueLabel?: string;
    accentColor?: string;
    isLive?: boolean;
  };
  onComplete: (id: string) => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
  onPress: (id: string) => void;
}

export const ReminderCard: React.FC<ReminderCardProps> = memo(({ reminder, onComplete, onArchive, onDelete, onPress }) => {
  const date = parseISO(reminder.dueAt);
  const isValidDate = Number.isFinite(date.getTime());
  const isOverdue = useMemo(() => {
    return reminder.urgencyState === 'overdue' || (
      isValidDate &&
      reminder.status !== 'completed' &&
      isBefore(date, new Date()) &&
      !isToday(date)
    );
  }, [date, isValidDate, reminder.status, reminder.urgencyState]);

  const accentColor = reminder.accentColor || getSemanticColor(reminder.semanticType, isOverdue);

  const getFormattedDate = () => {
    if (!isValidDate) return 'No fixed time';
    if (reminder.dueLabel) return reminder.dueLabel;
    if (isToday(date)) return `Today, ${format(date, 'h:mm a')}`;
    if (isTomorrow(date)) return `Tomorrow, ${format(date, 'h:mm a')}`;
    return format(date, 'EEE, MMM d · h:mm a');
  };

  const addToCalendar = async () => {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Calendar access is required to add events.');
        return;
      }
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      if (!calendars || calendars.length === 0) {
        Alert.alert('No Calendars', 'No calendars found on this device.');
        return;
      }
      const defaultCalendar = calendars.find(c => c.isPrimary) || calendars.find(c => c.allowsModifications) || calendars[0];

      const startDate = isValidDate ? date : new Date();
      const eventId = await Calendar.createEventAsync(defaultCalendar.id, {
        title: reminder.title,
        startDate,
        endDate: new Date(startDate.getTime() + 60 * 60 * 1000),
        timeZone: 'GMT',
        notes: `Created by EchoMind\nCategory: ${reminder.category}`,
      });

      if (eventId) {
        Alert.alert('Success', 'Added to your calendar.');
      }
    } catch (e) {
      console.warn('Failed to add to calendar', e);
      Alert.alert('Error', 'Could not add event to calendar.');
    }
  };

  const confirmDelete = () => {
    if (!onDelete) return;
    Alert.alert('Delete reminder?', 'This removes the reminder from your local task center.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(reminder.id) },
    ]);
  };

  const timingText = reminder.countdownLabel || reminder.relativeTiming || getFormattedDate();
  const stateLabel = getStateLabel(reminder.urgencyState, reminder.status);

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      layout={LinearTransition}
      style={[
        styles.container,
        { borderColor: tint(accentColor, isOverdue ? 0.3 : 0.18) },
        reminder.status === 'completed' && styles.containerCompleted,
        isOverdue && styles.containerOverdue,
        reminder.isLive && styles.containerLive,
      ]}
    >
      <Swipeable
        renderLeftActions={() => (
          <TouchableOpacity
            style={styles.archiveAction}
            onPress={() => onArchive?.(reminder.id)}
          >
            <Archive size={24} color="#fcf8fe" />
            <Text style={styles.swipeText}>Archive</Text>
          </TouchableOpacity>
        )}
        renderRightActions={() => (
          <TouchableOpacity
            style={[styles.swipeAction, reminder.status === 'completed' ? styles.swipeUndo : null]}
            onPress={() => onComplete(reminder.id)}
          >
            <CheckCircle size={26} color="#fcf8fe" />
            <Text style={styles.swipeText}>
              {reminder.status === 'completed' ? 'Undo' : 'Done'}
            </Text>
          </TouchableOpacity>
        )}
      >
        <TouchableOpacity activeOpacity={0.86} onPress={() => onPress(reminder.id)} onLongPress={confirmDelete}>
          <View style={[styles.surface, isOverdue && styles.surfaceOverdue, reminder.isLive && styles.surfaceLive]}>
            <View style={styles.topRow}>
              <View style={[styles.semanticPill, { backgroundColor: tint(accentColor, 0.12) }]}>
                <View style={[styles.dot, { backgroundColor: accentColor }]} />
                <Text style={[styles.semanticText, { color: accentColor }]}>{reminder.category}</Text>
              </View>
              <Text style={[styles.stateText, { color: accentColor }]}>{stateLabel}</Text>
            </View>

            <View style={styles.header}>
              <View style={styles.titleBlock}>
                <Text style={styles.title} numberOfLines={1}>{getFormattedDate()}</Text>
                <Text style={styles.secondaryTitle} numberOfLines={3}>{reminder.title}</Text>
                {!!reminder.participant && (
                  <View style={styles.participantRow}>
                    <Users size={12} color="rgba(252, 248, 254, 0.42)" />
                    <Text style={styles.participantText} numberOfLines={1}>{reminder.participant}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={() => onComplete(reminder.id)} style={styles.checkButton}>
                {reminder.status === 'completed' ? (
                  <CheckCircle size={24} color="#86efac" />
                ) : (
                  <View style={[styles.checkCircle, { borderColor: tint(accentColor, 0.5) }]} />
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.footer}>
              <View style={[styles.infoRow, { backgroundColor: tint(accentColor, 0.08) }]}>
                {reminder.isLive ? (
                  <CalendarClock size={14} color={accentColor} />
                ) : (
                  <Clock size={14} color={accentColor} />
                )}
                <Text style={[styles.dateText, { color: accentColor }]}>{timingText}</Text>
              </View>
            </View>

            <View style={styles.actionRow}>
              {!!reminder.sourceSessionId && (
                <TouchableOpacity style={styles.sourceRow} onPress={() => onPress(reminder.id)}>
                  <ExternalLink size={12} color="rgba(252, 248, 254, 0.38)" />
                  <Text style={styles.sourceText}>Open source</Text>
                </TouchableOpacity>
              )}

              <View style={styles.trailingActions}>
                {!!onDelete && (
                  <TouchableOpacity style={styles.iconButton} onPress={confirmDelete}>
                    <Trash2 size={13} color="rgba(252, 248, 254, 0.44)" />
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.calendarButton} onPress={addToCalendar}>
                  <Text style={styles.calendarButtonText}>Calendar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Swipeable>
    </Animated.View>
  );
});

function getSemanticColor(type?: ReminderSemanticType, isOverdue = false): string {
  if (isOverdue || type === 'overdue') return '#f87171';
  switch (type) {
    case 'meeting':
      return '#c799ff';
    case 'deadline':
      return '#fbbf24';
    case 'completed':
      return '#86efac';
    case 'reminder':
    default:
      return '#4af8e3';
  }
}

function getStateLabel(state?: ReminderUrgencyState, status?: string): string {
  if (status === 'completed' || state === 'completed') return 'Completed';
  if (state === 'live') return 'Active';
  if (state === 'overdue') return 'Overdue';
  if (state === 'due_today') return 'Today';
  if (state === 'upcoming') return 'Upcoming';
  return 'Open';
}

function tint(hex: string, opacity: number): string {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 14,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.024)',
  },
  containerCompleted: {
    opacity: 0.58,
  },
  containerOverdue: {
    backgroundColor: 'rgba(248, 113, 113, 0.025)',
  },
  containerLive: {
    backgroundColor: 'rgba(199, 153, 255, 0.035)',
  },
  surface: {
    padding: 15,
    backgroundColor: 'transparent',
  },
  surfaceOverdue: {
    backgroundColor: 'rgba(248, 113, 113, 0.025)',
  },
  surfaceLive: {
    backgroundColor: 'rgba(199, 153, 255, 0.035)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 11,
    gap: 12,
  },
  semanticPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  semanticText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  stateText: {
    fontSize: 11,
    fontWeight: '800',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    color: '#fcf8fe',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    letterSpacing: 0,
  },
  secondaryTitle: {
    color: 'rgba(252, 248, 254, 0.64)',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 7,
  },
  participantText: {
    color: 'rgba(252, 248, 254, 0.46)',
    fontSize: 12,
    fontWeight: '600',
  },
  checkButton: {
    marginLeft: 12,
    padding: 2,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    flexShrink: 1,
  },
  dateText: {
    fontSize: 12,
    fontWeight: '800',
  },
  absoluteDateText: {
    color: 'rgba(252, 248, 254, 0.42)',
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 0,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.025)',
    gap: 12,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  sourceText: {
    color: 'rgba(252, 248, 254, 0.38)',
    fontSize: 11,
    fontWeight: '700',
  },
  trailingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
  },
  calendarButton: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(199, 186, 255, 0.055)',
  },
  calendarButtonText: {
    color: '#c799ff',
    fontSize: 11,
    fontWeight: '800',
  },
  swipeAction: {
    backgroundColor: 'rgba(134, 239, 172, 0.42)',
    justifyContent: 'center',
    alignItems: 'center',
    width: 86,
    height: '100%',
  },
  swipeUndo: {
    backgroundColor: 'rgba(251, 191, 36, 0.42)',
  },
  archiveAction: {
    backgroundColor: 'rgba(74, 248, 227, 0.32)',
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    height: '100%',
  },
  swipeText: {
    color: '#fcf8fe',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 4,
  },
});
