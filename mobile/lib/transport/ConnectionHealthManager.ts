const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const PING_INTERVAL_MS = 15000;

export class ConnectionHealthManager {
  private attempts = 0;
  private currentBackoff = INITIAL_BACKOFF_MS;
  private pingInterval: NodeJS.Timeout | null = null;
  private onHealthDegraded: () => void;

  constructor(onHealthDegraded: () => void) {
    this.onHealthDegraded = onHealthDegraded;
  }

  /**
   * Called on a successful connection to reset backoffs and start pinging.
   */
  public reportSuccess(apiUrl: string) {
    this.attempts = 0;
    this.currentBackoff = INITIAL_BACKOFF_MS;
    this.startPinging(apiUrl);
  }

  /**
   * Called on a failure. Returns the milliseconds to wait before the next attempt,
   * or null if we've exhausted our attempts.
   */
  public reportFailure(): number | null {
    this.stopPinging();
    if (this.attempts >= MAX_RECONNECT_ATTEMPTS) {
      return null; // Exhausted
    }
    
    const jitter = Math.random() * 1000;
    const waitTime = this.currentBackoff + jitter;
    this.attempts++;
    this.currentBackoff = Math.min(this.currentBackoff * 2, MAX_BACKOFF_MS);
    return waitTime;
  }

  public reset() {
    this.attempts = 0;
    this.currentBackoff = INITIAL_BACKOFF_MS;
    this.stopPinging();
  }

  private startPinging(apiUrl: string) {
    this.stopPinging();
    this.pingInterval = setInterval(async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${apiUrl}/api/health`, {
          signal: controller.signal,
          headers: { 'Accept': 'application/json' }
        });
        clearTimeout(timeout);
        if (!res.ok) {
          throw new Error('Health check non-ok');
        }
      } catch (e) {
        this.stopPinging();
        this.onHealthDegraded();
      }
    }, PING_INTERVAL_MS);
  }

  public stopPinging() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
