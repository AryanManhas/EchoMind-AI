import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { Bell } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../constants/theme';

export function TopAppBar() {
  const insets = useSafeAreaInsets();
  
  return (
    <View style={{ paddingTop: insets.top }} className="w-full z-50 absolute top-0 left-0 right-0">
      <BlurView intensity={40} tint="dark" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(19, 19, 23, 0.6)' }]} />
      
      <View className="flex-row justify-between items-center px-5 py-3 w-full relative z-10">
        <View className="flex-row items-center gap-3">
          <View className="w-8 h-8 rounded-full items-center justify-center overflow-hidden border border-[#48474c]/15" style={{ backgroundColor: theme.colors.surfaceContainerLow }}>
            <Image 
              source={{ uri: "https://lh3.googleusercontent.com/aida-public/AB6AXuCDPISNfeoPhxHe3OKIKhWEQpb-fJmMgxEzSwOIwRIbV-K1a1JH65bYyZsFoS2_Kjv0g1Us0BgQTlZFEkw4l687WTWKAsvcOEMRMl-8l_9Fgy-l1ECeqSP9jtz0HxNm3TCcI8BWn2UN_VhJCDT6JMb5d127HZIm9qQ_hAG3StrSPuXlMntjD8KhALclJ_DPWW5XudWXkzscCwl7zJ_PRVaNnQuL2YzonsA0D_4F9SXdNQocqJy7sukPxn4bycmOkcquoVFubks8b3WT" }}
              className="w-full h-full"
            />
          </View>
          <Text className="text-lg font-medium tracking-tight" style={{ color: theme.colors.textPrimary }}>EchoMind</Text>
        </View>
        
        <TouchableOpacity className="active:scale-95 transition-transform">
          <Bell color={theme.colors.textSecondary} size={20} />
        </TouchableOpacity>
      </View>

      <LinearGradient
        colors={['transparent', 'rgba(72, 71, 76, 0.10)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        className="h-[1px] w-full absolute bottom-0 z-10"
      />
    </View>
  );
}
