import { ConnectionMetadata, TransportState } from './types';
import { DiscoveryManager } from './DiscoveryManager';
import { BackendRegistry } from './BackendRegistry';
import { ConnectionHealthManager } from './ConnectionHealthManager';

export type TransportListener = (state: TransportState, metadata: ConnectionMetadata | null) => void;

class TransportManagerImpl {
  private state: TransportState = 'discovering';
  private metadata: ConnectionMetadata | null = null;
  private listeners: Set<TransportListener> = new Set();
  
  private healthManager: ConnectionHealthManager;
  private isInitializing = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.healthManager = new ConnectionHealthManager(() => {
      this.handleDegraded();
    });
  }

  public subscribe(listener: TransportListener): () => void {
    this.listeners.add(listener);
    listener(this.state, this.metadata);
    return () => this.listeners.delete(listener);
  }

  private setState(newState: TransportState, newMetadata?: ConnectionMetadata | null) {
    if (newMetadata !== undefined) {
      this.metadata = newMetadata;
    }
    if (this.state !== newState) {
      console.log(`[TransportManager] State changed: ${this.state} -> ${newState}`);
      this.state = newState;
      this.listeners.forEach(l => l(this.state, this.metadata));
    } else {
      // Just notify metadata update if state didn't change
      this.listeners.forEach(l => l(this.state, this.metadata));
    }
  }

  public getState() {
    return this.state;
  }

  public getMetadata() {
    return this.metadata;
  }

  public getApiUrl(): string {
    return this.metadata?.apiUrl || '';
  }

  public getWsUrl(): string {
    return this.metadata?.wsUrl || '';
  }

  public async initialize() {
    if (this.isInitializing) return;
    this.isInitializing = true;
    await this.connect();
    this.isInitializing = false;
  }

  private async connect() {
    this.setState('discovering');
    
    // 1. Try last known good config first
    const cached = await BackendRegistry.getLastKnownBackend();
    if (cached) {
      const probeResult = await DiscoveryManager.probeEndpoint(cached.apiUrl, 0.90);
      if (probeResult) {
        return this.handleSuccess(probeResult);
      }
    }

    // 2. Full discovery sweep
    const discovered = await DiscoveryManager.discover();
    if (discovered) {
      return this.handleSuccess(discovered);
    }

    // 3. Fallback to offline
    this.handleFailure();
  }

  private handleSuccess(metadata: ConnectionMetadata) {
    BackendRegistry.saveBackend(metadata);
    this.healthManager.reportSuccess(metadata.apiUrl);
    
    if (metadata.runtime === 'local') {
      this.setState('local_ready', metadata);
    } else if (metadata.runtime === 'cloud' || metadata.runtime === 'hybrid') {
      this.setState('cloud_ready', metadata);
    } else {
      this.setState('connected', metadata);
    }
  }

  private handleFailure() {
    const waitTime = this.healthManager.reportFailure();
    if (waitTime === null) {
      this.setState('offline_ready');
    } else {
      this.setState('reconnecting');
      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, waitTime);
    }
  }

  private handleDegraded() {
    this.setState('degraded');
    this.handleFailure(); // Trigger reconnect logic
  }

  public forceReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.healthManager.reset();
    this.connect();
  }
}

export const TransportManager = new TransportManagerImpl();
