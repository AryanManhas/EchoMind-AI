import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { GlassCard } from './GlassCard';
import { CheckCircle2, User } from 'lucide-react-native';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';

interface ActionItemCardProps {
  person: string;
  responsibility: string;
  onComplete?: () => void;
}

export function ActionItemCard({ person, responsibility, onComplete }: ActionItemCardProps) {
  return (
    <Animated.View entering={FadeInUp} exiting={FadeOutDown} style={styles.container}>
      <GlassCard intensity={30} tint="dark" style={styles.card}>
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.personContainer}>
              <User size={14} color="#a78bfa" />
              <Text style={styles.personText}>{person}</Text>
            </View>
          </View>
          
          <Text style={styles.responsibilityText}>{responsibility}</Text>
        </View>

        {!!onComplete && (
          <TouchableOpacity style={styles.actionButton} onPress={onComplete}>
            <CheckCircle2 size={20} color="#34d399" />
          </TouchableOpacity>
        )}
      </GlassCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  personContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(167, 139, 250, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  personText: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  responsibilityText: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 22,
  },
  actionButton: {
    padding: 8,
    marginLeft: 12,
  },
});
