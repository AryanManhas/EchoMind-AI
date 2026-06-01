import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { Sparkles, Compass, LineChart, User } from 'lucide-react-native';
import { useRouter, usePathname } from 'expo-router';
import { theme } from '../constants/theme';

export function BottomNavBar() {
  const router = useRouter();
  const pathname = usePathname();

  const isListener = pathname === '/listener' || pathname === '/';
  const isFeed = pathname === '/feed';

  return (
    <View className="absolute bottom-6 left-0 right-0 z-50 flex-row justify-center items-center px-4" pointerEvents="box-none">
      <View 
        className="rounded-3xl w-[90%] max-w-md flex-row justify-around items-center p-2 shadow-2xl overflow-hidden" 
        style={{ backgroundColor: 'rgba(19, 19, 23, 0.5)', borderColor: theme.colors.borderGhost, borderWidth: 1 }}
        pointerEvents="auto"
      >
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} className="absolute inset-0" />
        
        <TouchableOpacity 
          className="relative rounded-2xl p-3 active:scale-90"
          onPress={() => router.push('/listener')}
          style={{ backgroundColor: isListener ? 'rgba(199, 153, 255, 0.1)' : 'transparent' }}
        >
          <Sparkles color={isListener ? theme.colors.primary : theme.colors.textTertiary} size={22} />
        </TouchableOpacity>

        <TouchableOpacity 
          className="rounded-2xl p-3 active:scale-90"
          onPress={() => router.push('/feed')}
          style={{ backgroundColor: isFeed ? 'rgba(199, 153, 255, 0.1)' : 'transparent' }}
        >
          <Compass color={isFeed ? theme.colors.primary : theme.colors.textTertiary} size={22} />
        </TouchableOpacity>

        <TouchableOpacity className="rounded-2xl p-3 active:scale-90">
          <LineChart color={theme.colors.textTertiary} size={22} />
        </TouchableOpacity>

        <TouchableOpacity className="rounded-2xl p-3 active:scale-90">
          <User color={theme.colors.textTertiary} size={22} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
