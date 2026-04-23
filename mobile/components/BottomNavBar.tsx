import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { Sparkles, Compass, LineChart, User } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, usePathname } from 'expo-router';

export function BottomNavBar() {
  const router = useRouter();
  const pathname = usePathname();

  const isListener = pathname === '/listener' || pathname === '/';
  const isFeed = pathname === '/feed';

  return (
    <View className="absolute bottom-6 left-0 right-0 z-50 flex-row justify-center items-center px-4" pointerEvents="box-none">
      <View className="bg-[#25252b]/40 border border-[#48474c]/30 rounded-2xl w-[90%] max-w-md flex-row justify-around items-center p-2 shadow-2xl overflow-hidden" pointerEvents="auto">
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} className="absolute inset-0" />
        
        <TouchableOpacity 
          className="relative rounded-xl p-3 shadow-lg active:scale-90"
          onPress={() => router.push('/listener')}
        >
          {isListener ? (
            <LinearGradient
              colors={['#c799ff', '#bc87fe']}
              style={StyleSheet.absoluteFill}
              className="rounded-xl"
            />
          ) : null}
          <Sparkles color={isListener ? "#0e0e12" : "rgba(252, 248, 254, 0.5)"} size={24} />
        </TouchableOpacity>

        <TouchableOpacity 
          className="p-3 active:scale-90"
          onPress={() => router.push('/feed')}
        >
          <Compass color={isFeed ? "#fcf8fe" : "rgba(252, 248, 254, 0.5)"} size={24} />
        </TouchableOpacity>

        <TouchableOpacity className="p-3 active:scale-90">
          <LineChart color={"rgba(252, 248, 254, 0.5)"} size={24} />
        </TouchableOpacity>

        <TouchableOpacity className="p-3 active:scale-90">
          <User color={"rgba(252, 248, 254, 0.5)"} size={24} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
