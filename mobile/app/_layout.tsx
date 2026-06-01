import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { useEffect } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useNotifications } from '../hooks/useNotifications';
import { useTransport } from '../hooks/useTransport';

let globalErrorGuardInstalled = false;

function installGlobalErrorGuard() {
  if (globalErrorGuardInstalled) return;
  globalErrorGuardInstalled = true;

  const errorUtils = (globalThis as any).ErrorUtils;
  const previousHandler = errorUtils?.getGlobalHandler?.();
  errorUtils?.setGlobalHandler?.((error: Error, isFatal?: boolean) => {
    if (__DEV__) {
      console.error('[GlobalError]', error, { isFatal });
    }
    previousHandler?.(error, isFatal);
  });
}

export default function RootLayout() {
  useNotifications();
  useTransport();

  useEffect(() => {
    installGlobalErrorGuard();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <ErrorBoundary>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="detail" options={{ presentation: 'modal' }} />
        </Stack>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
