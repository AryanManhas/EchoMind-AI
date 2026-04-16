import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { 
  useAnimatedStyle, 
  useSharedValue, 
  withSpring, 
  withTiming,
  interpolate,
  Extrapolate
} from 'react-native-reanimated';

interface PulseWaveformProps {
  audioLevel?: number; // 0 to -160 (or normalized 0 to 10)
  isRecording: boolean;
}

const PulseWaveform: React.FC<PulseWaveformProps> = ({ audioLevel = 0, isRecording }) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    if (isRecording) {
      // Normalize audioLevel (Voice usually returns values around -160 to 0)
      // If we assume a normalized 0-10:
      const normalizedLevel = Math.max(1, (audioLevel + 2) / 2); // Simple heuristic
      scale.value = withSpring(normalizedLevel, { damping: 10, stiffness: 100 });
      opacity.value = withTiming(0.8);
    } else {
      scale.value = withSpring(1);
      opacity.value = withTiming(0.3);
    }
  }, [audioLevel, isRecording]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={styles.container}>
      {/* Outer Glow */}
      <Animated.View style={[styles.orb, styles.glow, animatedStyle]} />
      {/* Inner Orb */}
      <View style={styles.innerOrb} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 200,
  },
  orb: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#00D4FF', // Cyan pulse
  },
  glow: {
    position: 'absolute',
    shadowColor: '#00D4FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 20,
  },
  innerOrb: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#001220', // Dark center
    borderWidth: 2,
    borderColor: '#00D4FF',
    zIndex: 2,
  },
});

export default PulseWaveform;
