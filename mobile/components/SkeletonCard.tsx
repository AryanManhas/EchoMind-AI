import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing, withSequence, withDelay } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  style?: any;
}

export function Skeleton({ width, height, borderRadius = 8, style }: SkeletonProps) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3, { duration: 1000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          overflow: 'hidden',
        },
        style,
        animatedStyle,
      ]}
    >
      <LinearGradient
        colors={['transparent', 'rgba(255,255,255,0.05)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Skeleton width={80} height={24} borderRadius={12} />
        <Skeleton width={20} height={20} borderRadius={10} />
      </View>
      <Skeleton width="80%" height={20} style={{ marginBottom: 8 }} />
      <Skeleton width="100%" height={16} style={{ marginBottom: 4 }} />
      <Skeleton width="60%" height={16} style={{ marginBottom: 16 }} />
      <View style={styles.footer}>
        <Skeleton width={80} height={14} />
      </View>
    </View>
  );
}

export function SkeletonFeed() {
  return (
    <View style={styles.container}>
      {[1, 2, 3, 4].map(i => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    gap: 16,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  footer: {
    flexDirection: 'row',
    marginTop: 8,
  },
});
