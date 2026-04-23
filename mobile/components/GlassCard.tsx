import React from 'react';
import { View, ViewProps, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';

export interface GlassCardProps extends ViewProps {
  intensity?: number;
  tint?: 'light' | 'dark' | 'default';
  blurClassName?: string;
}

export function GlassCard({ 
  intensity = 24, 
  tint = 'dark', 
  className = '', 
  blurClassName = '', 
  children, 
  ...props 
}: GlassCardProps) {
  return (
    <View 
      className={`rounded-2xl border border-white/10 overflow-hidden relative ${className}`}
      {...props}
    >
      <BlurView 
        intensity={intensity} 
        tint={tint} 
        style={StyleSheet.absoluteFill}
        className={blurClassName} 
      />
      <View className="relative z-10 w-full h-full">
        {children}
      </View>
    </View>
  );
}
