import { ConnectionMetadata } from './types';
import Constants from 'expo-constants';
import { ENV } from '../env';

const DEV_BACKEND_PORT = '8090';
const PROBE_TIMEOUT_MS = 2000;

export class DiscoveryManager {
  /**
   * Probes an API URL to see if it exposes the EchoMind handshake.
   */
  static async probeEndpoint(apiUrl: string, baseConfidence: number = 0.5): Promise<ConnectionMetadata | null> {
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      
      const response = await fetch(`${apiUrl}/api/health`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      
      clearTimeout(timeoutId);
      const latency = Date.now() - startTime;
      
      if (response.ok) {
        const data = await response.json();
        // Handshake verification
        if (data.status === 'ok' && data.runtime) {
          const wsUrl = apiUrl.replace(/^http/, 'ws');
          
          // Adjust confidence based on latency (max 1.0, min 0.1)
          const latencyBonus = latency < 150 ? 0.1 : latency > 1000 ? -0.1 : 0;
          const confidenceScore = Math.min(1.0, Math.max(0.1, baseConfidence + latencyBonus));

          return {
            apiUrl,
            wsUrl,
            runtime: data.runtime || 'local',
            version: data.version || '1.0',
            features: data.features || {
              semanticMemory: false,
              proactiveAssistant: false,
              meetingIntelligence: false,
            },
            lastConnected: Date.now(),
            confidenceScore,
          };
        }
      }
    } catch (e) {
      // Ignored for probing
    }
    return null;
  }

  /**
   * Extracts the host from Expo manifest.
   */
  private static getExpoHost(): string | null {
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
    return null;
  }

  private static lastScanTime = 0;
  private static COOLDOWN_MS = 15000;

  /**
   * Discovers the backend by trying the most probable URLs first, then falling back to a bounded subnet sweep.
   */
  static async discover(): Promise<ConnectionMetadata | null> {
    const now = Date.now();
    if (now - this.lastScanTime < this.COOLDOWN_MS) {
      return null;
    }
    this.lastScanTime = now;

    const targets: { url: string; baseConfidence: number }[] = [];

    // 1. Explicitly configured ENV URL
    if (ENV.API_URL) {
      targets.push({ url: ENV.API_URL, baseConfidence: 0.95 });
    }

    // 2. Expo dev host
    let hostIp: string | null = null;
    if (__DEV__) {
      const host = this.getExpoHost();
      if (host) {
        hostIp = host;
        targets.push({ url: `http://${host}:${DEV_BACKEND_PORT}`, baseConfidence: 0.80 });
      }
    }

    // Attempt direct targets sequentially (fast fail)
    for (const target of targets) {
      const result = await this.probeEndpoint(target.url, target.baseConfidence);
      if (result) return result;
    }

    // 3. Subnet inference + Bounded local probe (max 10 probes)
    if (__DEV__ && hostIp && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostIp)) {
      const parts = hostIp.split('.');
      const subnetPrefix = parts.slice(0, 3).join('.');
      const hostSuffix = parseInt(parts[3], 10);

      const urlsToProbe: string[] = [];
      // Probe ±5 surrounding suffixes
      for (let offset = -5; offset <= 5; offset++) {
        if (offset === 0) continue;
        const suffix = hostSuffix + offset;
        if (suffix > 0 && suffix < 255) {
          urlsToProbe.push(`http://${subnetPrefix}.${suffix}:${DEV_BACKEND_PORT}`);
        }
      }

      const promises = urlsToProbe.map(url => this.probeEndpoint(url, 0.50));
      const results = (await Promise.all(promises)).filter((r): r is ConnectionMetadata => r !== null);
      if (results.length > 0) {
        results.sort((a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0));
        return results[0];
      }
    }

    return null;
  }
}
