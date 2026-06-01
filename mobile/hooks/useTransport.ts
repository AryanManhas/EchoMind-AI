import { useState, useEffect } from 'react';
import { TransportManager } from '../lib/transport';
import { TransportState, ConnectionMetadata } from '../lib/transport/types';

export function useTransport() {
  const [state, setState] = useState<TransportState>(TransportManager.getState());
  const [metadata, setMetadata] = useState<ConnectionMetadata | null>(TransportManager.getMetadata());

  useEffect(() => {
    // Start discovery if not already connecting/connected
    if (state === 'discovering' && !TransportManager.getApiUrl()) {
      TransportManager.initialize();
    }
    
    const unsubscribe = TransportManager.subscribe((newState, newMetadata) => {
      setState(newState);
      setMetadata(newMetadata);
    });
    return unsubscribe;
  }, []);

  return {
    state,
    metadata,
    apiUrl: metadata?.apiUrl || '',
    wsUrl: metadata?.wsUrl || '',
    isReady: state === 'local_ready' || state === 'cloud_ready' || state === 'connected',
    isOffline: state === 'offline_ready',
    forceReconnect: () => TransportManager.forceReconnect()
  };
}
