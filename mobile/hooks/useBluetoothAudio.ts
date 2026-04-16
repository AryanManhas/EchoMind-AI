import { useEffect, useState } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';

/**
 * Hook to manage Bluetooth hardware state for EchoMind AI.
 * Uses InCallManager for modern Android/iOS audio routing.
 */
export const useBluetoothAudio = () => {
  const [isBluetoothConnected, setIsBluetoothConnected] = useState(false);
  const [availableDevices, setAvailableDevices] = useState<string[]>([]);

  useEffect(() => {
    // Start InCallManager to gain control over audio routing
    InCallManager.start({ media: 'audio' });

    const eventEmitter = new NativeEventEmitter(NativeModules.InCallManager);
    
    const subscription = eventEmitter.addListener('onAudioDeviceChanged', (data) => {
      // Data format: { availableAudioDeviceList: string (JSON), selectedAudioDevice: string }
      try {
        const devices = JSON.parse(data.availableAudioDeviceList);
        setAvailableDevices(devices);
        
        // Check if Bluetooth is in the available list or currently selected
        const hasBluetooth = devices.includes('BLUETOOTH');
        setIsBluetoothConnected(hasBluetooth);
      } catch (err) {
        console.error('Failed to parse audio device list', err);
      }
    });

    // InCallManager.start() usually triggers an initial onAudioDeviceChanged event.
    // If you need more granular check, standard device detection should happen via the listener.

    return () => {
      subscription.remove();
      InCallManager.stop();
    };
  }, []);

  return {
    isBluetoothConnected,
    availableDevices,
  };
};

export default useBluetoothAudio;
