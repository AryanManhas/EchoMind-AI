import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { User } from 'lucide-react-native';

interface ParticipantChipProps {
  name: string;
}

// Simple deterministic color generation from string
function getColorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 65%)`;
}

export function ParticipantChip({ name }: ParticipantChipProps) {
  const color = getColorForName(name);

  return (
    <View style={[styles.container, { borderColor: `${color}40`, backgroundColor: `${color}15` }]}>
      <View style={[styles.iconContainer, { backgroundColor: `${color}30` }]}>
        <User size={12} color={color} />
      </View>
      <Text style={[styles.name, { color }]}>{name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
  },
  iconContainer: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  name: {
    fontSize: 13,
    fontWeight: '500',
  },
});
