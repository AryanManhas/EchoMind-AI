import { Tabs } from 'expo-router';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { Sparkles, Compass } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 70 + insets.bottom,
          backgroundColor: 'rgba(14, 14, 18, 0.92)',
          borderTopWidth: 1,
          borderTopColor: 'rgba(255, 255, 255, 0.05)',
          paddingBottom: insets.bottom,
          paddingTop: 8,
          elevation: 0,
        },
        tabBarActiveTintColor: '#c799ff',
        tabBarInactiveTintColor: 'rgba(252, 248, 254, 0.35)',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.5,
          marginTop: 4,
        },
        sceneStyle: { backgroundColor: '#0e0e12' },
      }}
    >
      <Tabs.Screen
        name="listener"
        options={{
          title: 'Listen',
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? styles.activeIconWrap : undefined}>
              <Sparkles color={focused ? '#0e0e12' : color} size={22} />
              {focused && (
                <LinearGradient
                  colors={['#c799ff', '#a78bfa']}
                  style={[StyleSheet.absoluteFill, { borderRadius: 12 }]}
                />
              )}
              {focused && <Sparkles color="#0e0e12" size={22} style={{ position: 'absolute' }} />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Memories',
          tabBarIcon: ({ color }) => <Compass color={color} size={22} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  activeIconWrap: {
    width: 40,
    height: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
