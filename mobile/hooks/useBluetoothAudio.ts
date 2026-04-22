import { useEffect, useState } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';

// Initialize the event emitter with the appropriate native module
// Note: Ensure 'BluetoothDeviceModule' matches the name of your native bridge
const { BluetoothDeviceModule } = NativeModules;
const eventEmitter = new NativeEventEmitter(BluetoothDeviceModule);

/**
 * Hook to manage Bluetooth hardware state for EchoMind AI.
 * Uses InCallManager for modern Android/iOS audio routing.
 */
export const useBluetoothAudio = () => {
  const [isBluetoothConnected, setIsBluetoothConnected] = useState(false);
  const [availableDevices, setAvailableDevices] = useState<string[]>([]);
  const [deviceName, setDeviceName] = useState<string | null>(null);

  useEffect(() => {
    // Start InCallManager to gain control over audio routing
    InCallManager.start({ media: 'audio' });

    const fetchDeviceName = (retryCount = 0) => {
      console.log(`[Bluetooth] Fetching device name (Attempt ${retryCount + 1})...`);
      BluetoothDeviceModule.getConnectedDeviceName()
        .then((name: string | null) => {
          console.log('[Bluetooth] Native module returned:', name);
          if (name) {
            setDeviceName(name);
          } else if (retryCount < 3) {
            // Retry after 1 second if still null (Android profile connection can be slow)
            setTimeout(() => fetchDeviceName(retryCount + 1), 1000);
          }
        })
        .catch((err: any) => {
          console.warn('[Bluetooth] Failed to get device name:', err);
        });
    };

    // Correctly using the initialized eventEmitter
    const subscription = eventEmitter.addListener('onAudioDeviceChanged', (data) => {
      console.log('[Bluetooth] Audio Device Changed:', data);
      try {
        const devices = typeof data.availableAudioDeviceList === 'string'
          ? JSON.parse(data.availableAudioDeviceList)
          : data.availableAudioDeviceList;

        setAvailableDevices(devices);

        const hasBluetooth = devices.includes('BLUETOOTH');
        console.log('[Bluetooth] Connection status:', hasBluetooth);
        setIsBluetoothConnected(hasBluetooth);

        if (hasBluetooth) {
          fetchDeviceName();
        } else {
          setDeviceName(null);
        }
      } catch (err) {
        console.error('[Bluetooth] Failed to parse device list:', err);
      }
    });

    return () => {
      subscription.remove();
      InCallManager.stop();
    };
  }, []);

  return {
    isBluetoothConnected,
    availableDevices,
    deviceName,
  };
};

export default useBluetoothAudio;