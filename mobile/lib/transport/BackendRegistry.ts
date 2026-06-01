import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConnectionMetadata } from './types';

const STORAGE_KEY = '@EchoMind:BackendMetadata';

export class BackendRegistry {
  /**
   * Retrieves the last known successful backend configuration.
   */
  static async getLastKnownBackend(): Promise<ConnectionMetadata | null> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      if (data) {
        return JSON.parse(data) as ConnectionMetadata;
      }
    } catch (error) {
      console.warn('[BackendRegistry] Failed to load last known backend:', error);
    }
    return null;
  }

  /**
   * Saves the current successful backend configuration for future fast-reconnects.
   */
  static async saveBackend(metadata: ConnectionMetadata): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(metadata));
    } catch (error) {
      console.warn('[BackendRegistry] Failed to save backend metadata:', error);
    }
  }

  /**
   * Clears the registered backend (useful for force-resets or cloud fallback testing).
   */
  static async clear(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn('[BackendRegistry] Failed to clear backend metadata:', error);
    }
  }
}
