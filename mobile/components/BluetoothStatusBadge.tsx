import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

interface BluetoothStatusBadgeProps {
  isConnected: boolean;
  deviceName: string | null;
}

const BluetoothStatusBadge: React.FC<BluetoothStatusBadgeProps> = ({ isConnected, deviceName }) => {
  const glowAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (isConnected) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: false,
          }),
          Animated.timing(glowAnim, {
            toValue: 0.4,
            duration: 1500,
            useNativeDriver: false,
          }),
        ])
      ).start();
    } else {
      glowAnim.setValue(0);
    }
  }, [isConnected]);

  const glowShadow = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 15],
  });

  return (
    <View style={styles.container}>
      <Animated.View 
        style={[
          styles.badge,
          { 
            backgroundColor: isConnected ? '#00F2FF' : '#333333',
            shadowColor: '#00F2FF',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: isConnected ? glowAnim : 0,
            shadowRadius: glowShadow,
            elevation: isConnected ? 10 : 0,
          }
        ]}
      >
        <Text style={[styles.statusText, { color: isConnected ? '#000000' : '#888888' }]}>
          {isConnected ? `🎧 ${deviceName || 'Headset Connected'}` : 'No Headset Found'}
        </Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
    zIndex: 100,
  },
  badge: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'System',
    letterSpacing: 0.5,
  },
});

export default BluetoothStatusBadge;
