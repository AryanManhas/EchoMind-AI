import React from 'react';
import { Pressable, StyleProp, ViewStyle, PressableProps, Vibration } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

interface SquishButtonProps extends Omit<PressableProps, 'style' | 'onPress'> {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  haptic?: 'light' | 'medium' | 'heavy' | 'success';
  squishScale?: number;
}

export function SquishButton({
  onPress,
  style,
  contentContainerStyle,
  children,
  haptic = 'light',
  squishScale = 0.95,
  ...props
}: SquishButtonProps) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
      opacity: opacity.value,
    };
  });

  const handlePressIn = (e: any) => {
    scale.value = withSpring(squishScale, { damping: 15, stiffness: 400 });
    opacity.value = withTiming(0.8, { duration: 100 });
    if (props.onPressIn) props.onPressIn(e);
  };

  const handlePressOut = (e: any) => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
    opacity.value = withTiming(1, { duration: 150 });
    if (props.onPressOut) props.onPressOut(e);
  };

  const handlePress = () => {
    if (haptic) {
      try {
        if (haptic === 'light') Vibration.vibrate(30);
        else if (haptic === 'medium') Vibration.vibrate(50);
        else if (haptic === 'heavy') Vibration.vibrate(80);
        else if (haptic === 'success') Vibration.vibrate([0, 40, 60, 40]);
      } catch (e) {
        // Ignore vibration errors
      }
    }
    if (onPress) onPress();
  };

  return (
    <Animated.View style={[style, animatedStyle]}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        style={contentContainerStyle}
        {...props}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
