import Constants from 'expo-constants';

/**
 * Environment configuration for the mobile application.
 * Automatically switches between local development and production URLs.
 */

const DEV_BACKEND_PORT = '8090';

function cleanEnvValue(value?: string): string {
  return value?.trim() || '';
}

function getExpoDevHost(): string {
  const constants = Constants as any;
  const candidates = [
    constants?.expoConfig?.hostUri,
    constants?.manifest?.debuggerHost,
    constants?.manifest?.hostUri,
    constants?.manifest2?.extra?.expoGo?.debuggerHost,
    constants?.manifest2?.extra?.expoGo?.packagerOpts?.hostUri,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const withoutProtocol = candidate.replace(/^[a-z]+:\/\//i, '');
    const host = withoutProtocol.split(/[/:]/)[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return host;
    }
  }

  return '';
}

function getDevBackendUrls(): { apiUrl: string; wsUrl: string } {
  const host = getExpoDevHost();
  if (!host) {
    return { apiUrl: '', wsUrl: '' };
  }

  return {
    apiUrl: `http://${host}:${DEV_BACKEND_PORT}`,
    wsUrl: `ws://${host}:${DEV_BACKEND_PORT}`,
  };
}

const devBackendUrls = __DEV__ ? getDevBackendUrls() : { apiUrl: '', wsUrl: '' };

export const ENV = {
  // prioritize EXPO_PUBLIC_ prefix (used by EAS and newer Expo versions)
  API_URL: cleanEnvValue(process.env.EXPO_PUBLIC_API_URL) || (__DEV__ ? devBackendUrls.apiUrl : ''),
  WS_URL: cleanEnvValue(process.env.EXPO_PUBLIC_WS_URL) || (__DEV__ ? devBackendUrls.wsUrl : ''),
  ENABLE_PUSH_NOTIFICATIONS: cleanEnvValue(process.env.EXPO_PUBLIC_ENABLE_PUSH_NOTIFICATIONS) === 'true',
  IS_PROD: !__DEV__,
};

// ─── No hard failures on missing API_URL ────
// TransportManager will handle dynamic discovery of backend API_URL and WS_URL.
if (!__DEV__) {
  if (!ENV.API_URL) {
    console.warn('[ENV] EXPO_PUBLIC_API_URL is missing. TransportManager will attempt discovery or fallback.');
  }
}

if (__DEV__) {
  if (!ENV.API_URL || !ENV.WS_URL) {
    console.log('[ENV] No explicit API_URL configured. DiscoveryManager will search for the backend on LAN.');
  }

  console.log('[ENV] Initialized with:', {
    API_URL: ENV.API_URL,
    WS_URL: ENV.WS_URL,
    PUSH_NOTIFICATIONS_ENABLED: ENV.ENABLE_PUSH_NOTIFICATIONS,
    IS_PROD: ENV.IS_PROD,
  });
}

export default ENV;
