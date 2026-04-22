import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';

const BAR_COUNT = 20;

const WaveformVisualizer = ({ audioLevel, isRecording }: any) => {
  const bars = useRef(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(2))
  ).current;

  useEffect(() => {
    if (isRecording) {
      bars.forEach((bar, i) => {
        Animated.loop(
          Animated.sequence([
            Animated.timing(bar, {
              toValue: Math.max(10, audioLevel * 100),
              duration: 200 + i * 20,
              useNativeDriver: false,
            }),
            Animated.timing(bar, {
              toValue: 5,
              duration: 200,
              useNativeDriver: false,
            }),
          ])
        ).start();
      });
    } else {
      bars.forEach(bar => bar.setValue(2));
    }
  }, [audioLevel, isRecording]);

  return (
    <View style={styles.container}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            {
              height: bar,
            },
          ]}
        />
      ))}
    </View>
  );
};

export default WaveformVisualizer;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginTop: 20,
  },
  bar: {
    width: 4,
    marginHorizontal: 2,
    backgroundColor: '#00F2FF',
    borderRadius: 2,
  },
});