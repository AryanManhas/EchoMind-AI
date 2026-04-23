import { Stack } from 'expo-router';
import { StatusBar, View, StyleSheet } from 'react-native';
import '../global.css';

export default function RootLayout() {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#050505" translucent />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0e0e12' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen 
          name="detail" 
          options={{ 
            presentation: 'modal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }} 
        />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0e0e12',
  },
});
