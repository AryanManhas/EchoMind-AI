import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';

const { height } = Dimensions.get('window');

const JarvisBackground = () => {
  const scanAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(scanAnim, {
        toValue: height,
        duration: 4000,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.grid} />

      <Animated.View
        style={[
          styles.scanLine,
          { transform: [{ translateY: scanAnim }] },
        ]}
      />

      <View style={styles.vignette} />
    </View>
  );
};

export default JarvisBackground;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  grid: {
    flex: 1,
    backgroundColor: '#050505',
  },
  scanLine: {
    position: 'absolute',
    width: '100%',
    height: 2,
    backgroundColor: '#00F2FF',
    opacity: 0.2,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
});