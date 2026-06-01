import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import ENV from '../lib/env';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function useNotifications() {
  const notificationListener = useRef<any>(null);
  const responseListener = useRef<any>(null);

  useEffect(() => {
    void ensureLocalNotificationsAsync();

    if (ENV.ENABLE_PUSH_NOTIFICATIONS) {
      registerForPushNotificationsAsync().then(token => {
        if (__DEV__ && token && !(global as any).isPresentationMode) {
          console.log('[EchoMind] Push notification delivery active.');
        }
      }).catch(e => {
        warnLocalOnly('Push token registration failed; relying on local notifications.', e);
      });
    } else {
      warnLocalOnly('Push token registration disabled.');
    }

    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      if (__DEV__ && !(global as any).isPresentationMode) console.log('[EchoMind] Local notification delivered.');
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(async (response) => {
      if (__DEV__ && !(global as any).isPresentationMode) console.log('[EchoMind] Notification interaction handled.', response.actionIdentifier);
      
      const actionId = response.actionIdentifier;
      const data = response.notification.request.content.data;
      const taskId = data?.taskId as string | undefined;

      if (!taskId) return;

      if (actionId === 'mark_complete') {
        try {
          // Direct AsyncStorage mutation since the hook will reload on app foreground
          const REMINDER_STORAGE_KEY = '@EchoMind:Reminders';
          const REMINDER_BACKUP_KEY = '@EchoMind:Reminders:Backup';
          const stored = await AsyncStorage.getItem(REMINDER_STORAGE_KEY);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
              const updated = parsed.map(t => 
                t.id === taskId ? { ...t, state: 'completed', updatedAt: Date.now() } : t
              );
              await AsyncStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(updated));
              await AsyncStorage.setItem(REMINDER_BACKUP_KEY, JSON.stringify(updated));
            }
          }
          await Notifications.cancelScheduledNotificationAsync(response.notification.request.identifier);
        } catch (e) {
          if (__DEV__) console.warn('Failed to mark task complete from notification', e);
        }
      } else if (actionId === 'remind_later') {
        // Remind again in 15 minutes
        try {
          const originalContent = response.notification.request.content;
          await Notifications.scheduleNotificationAsync({
            content: {
              title: originalContent.title || 'EchoMind Reminder',
              body: originalContent.body || '',
              data: originalContent.data,
              categoryIdentifier: 'reminder_actions',
            },
            trigger: {
              seconds: 15 * 60,
              channelId: 'reminders',
            } as any,
          });
        } catch (e) {
          if (__DEV__) console.warn('Failed to reschedule task from notification', e);
        }
      } else if (actionId === 'open_session' || actionId === Notifications.DEFAULT_ACTION_IDENTIFIER) {
        if (data?.sourceSessionId) {
          router.push(`/detail?id=${data.sourceSessionId}`);
        }
      }
    });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, []);

  return null;
}

let didWarnLocalOnly = false;

function warnLocalOnly(message: string, error?: unknown): void {
  if (!__DEV__ || (global as any).isPresentationMode || didWarnLocalOnly) return;
  didWarnLocalOnly = true;
  if (error) {
    console.log(`[EchoMind] Private local notifications enabled. (${message})`, error);
  } else {
    console.log(`[EchoMind] Private local notifications enabled. (${message})`);
  }
}

async function ensureLocalNotificationsAsync(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Reminders',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    } catch (e) {
      if (__DEV__ && !(global as any).isPresentationMode) console.log('[EchoMind] Note: Local notification channel adjustment skipped.', e);
    }
  }

  // Register categories for action buttons
  try {
    await Notifications.setNotificationCategoryAsync('reminder_actions', [
      {
        identifier: 'mark_complete',
        buttonTitle: 'Mark Complete',
        options: { isDestructive: false, isAuthenticationRequired: false },
      },
      {
        identifier: 'remind_later',
        buttonTitle: 'Remind in 15m',
        options: { isDestructive: false, isAuthenticationRequired: false },
      },
      {
        identifier: 'open_session',
        buttonTitle: 'Open Session',
        options: { isDestructive: false, opensAppToForeground: true },
      },
    ]);
  } catch (e) {
    if (__DEV__) console.warn('Failed to set notification categories', e);
  }
}

async function registerForPushNotificationsAsync() {
  let token;

  await ensureLocalNotificationsAsync();

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      warnLocalOnly('Notification permission denied; using in-app reminders only.');
      return;
    }
    
    // Project ID is required for Expo Go and newer versions of expo-notifications
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    
    try {
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    } catch (e) {
      warnLocalOnly('Push token unavailable; using local notifications exclusively.', e);
    }
  } else {
    warnLocalOnly('Physical device recommended for full push capabilities.');
  }

  return token;
}
