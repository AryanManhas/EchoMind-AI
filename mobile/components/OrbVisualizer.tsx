import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { 
  useAnimatedStyle, 
  useSharedValue, 
  withRepeat, 
  withTiming, 
  withSequence,
  Easing,
  withSpring
} from 'react-native-reanimated';
import { Mic, MicOff } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface OrbVisualizerProps {
  isRecording: boolean;
  audioLevel?: number;
}

export function OrbVisualizer({ isRecording, audioLevel = 0 }: OrbVisualizerProps) {
  const floatAnim = useSharedValue(0);
  const pulseAnim = useSharedValue(1);
  const glowOpacity = useSharedValue(0.2);

  useEffect(() => {
    floatAnim.value = withRepeat(
      withSequence(
        withTiming(-8, { duration: 2500, easing: Easing.inOut(Easing.ease) }),
        withTiming(8, { duration: 2500, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);

  useEffect(() => {
    if (isRecording) {
      const scale = 1 + Math.min(audioLevel * 0.3, 0.3);
      pulseAnim.value = withSpring(scale, { damping: 12, stiffness: 120 });
      glowOpacity.value = withSpring(0.4 + audioLevel * 0.3, { damping: 12 });
    } else {
      pulseAnim.value = withSpring(1);
      glowOpacity.value = withSpring(0.2);
    }
  }, [isRecording, audioLevel]);

  const animatedFloatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatAnim.value }]
  }));

  const animatedGlowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseAnim.value }],
    opacity: glowOpacity.value,
  }));

  return (
    <Animated.View style={[styles.wrapper, animatedFloatStyle]}>
      {/* Glow ring */}
      <Animated.View style={[styles.glowRing, animatedGlowStyle]} />

      {/* Main orb */}
      <View style={styles.orb}>
        <LinearGradient
          colors={
            isRecording
              ? ['rgba(199, 153, 255, 0.15)', 'rgba(74, 248, 227, 0.08)', 'rgba(199, 153, 255, 0.05)']
              : ['rgba(255, 255, 255, 0.04)', 'rgba(255, 255, 255, 0.02)', 'transparent']
          }
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Inner content */}
        <View style={styles.orbContent}>
          {/* Icon */}
          <View style={styles.iconWrap}>
            {isRecording ? (
              <Mic color="#c799ff" size={44} strokeWidth={1.5} />
            ) : (
              <MicOff color="rgba(252, 248, 254, 0.6)" size={44} strokeWidth={1.5} />
            )}
          </View>

          {/* Status */}
          <Text style={[styles.statusText, isRecording && styles.statusActive]}>
            {isRecording ? 'Listening...' : 'Tap to start'}
          </Text>
          
          {/* Dot indicator */}
          <View style={styles.dotRow}>
            <View style={[styles.dot, isRecording && styles.dotActive]} />
            <Text style={styles.dotLabel}>
              {isRecording ? 'Recording' : 'Ready'}
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 280,
    height: 280,
  },
  glowRing: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(199, 153, 255, 0.1)',
    shadowColor: '#c799ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 40,
    elevation: 8,
  },
  orb: {
    width: 260,
    height: 260,
    borderRadius: 130,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    shadowColor: '#c799ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 60,
    elevation: 12,
  },
  orbContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    marginBottom: 8,
  },
  statusText: {
    fontSize: 20,
    fontWeight: '700',
    color: 'rgba(252, 248, 254, 0.7)',
    letterSpacing: -0.3,
  },
  statusActive: {
    color: '#fcf8fe',
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#555',
  },
  dotActive: {
    backgroundColor: '#4af8e3',
  },
  dotLabel: {
    fontSize: 10,
    color: '#666',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
});
