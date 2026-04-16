import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { 
  useAnimatedStyle, 
  interpolate, 
  Extrapolate,
  withSpring,
  useDerivedValue
} from 'react-native-reanimated';

interface NeuralOrbProps {
  scale: number; // 0.0 to 1.0 (normalized from 0-10)
  isRecording: boolean;
}

const NeuralOrb: React.FC<NeuralOrbProps> = ({ scale, isRecording }) => {
  // Smooth out the scale changes
  const animatedScale = useDerivedValue(() => {
    return withSpring(scale, { damping: 15, stiffness: 100 });
  });

  const orbStyle = useAnimatedStyle(() => {
    const s = interpolate(
      animatedScale.value,
      [0, 1],
      [1, 1.8],
      Extrapolate.CLAMP
    );

    return {
      transform: [{ scale: s }],
      backgroundColor: '#4B0082', // Deep Violet
    };
  });

  const glowStyle = useAnimatedStyle(() => {
    const s = interpolate(
      animatedScale.value,
      [0, 1],
      [1.1, 2.5],
      Extrapolate.CLAMP
    );

    const opacity = interpolate(
      animatedScale.value,
      [0, 0.5, 1],
      [0.3, 0.6, 0.9],
      Extrapolate.CLAMP
    );

    return {
      transform: [{ scale: s }],
      opacity: isRecording ? opacity : 0.2,
      borderColor: '#00F2FF', // Neon Cyan
    };
  });

  return (
    <View style={styles.container}>
      {/* Outer Glow Pulse - Neon Cyan */}
      <Animated.View style={[styles.glow, glowStyle]} />

      {/* Core Orb - Deep Violet */}
      <Animated.View style={[styles.orb, orbStyle]}>
         <View style={styles.innerCore} />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 250,
    height: 250,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orb: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4B0082',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 15,
  },
  glow: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
    backgroundColor: 'rgba(0, 242, 255, 0.1)',
    shadowColor: '#00F2FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 30,
    elevation: 20,
  },
  innerCore: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  }
});

export default NeuralOrb;
