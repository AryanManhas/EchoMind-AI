'use client';

import { motion } from 'framer-motion';
import type { BackendSyncState } from '@/hooks/useBackendSync';

// ─── State-to-visual mappings ─────────────────────────────────

const STATE_CONFIG: Record<string, { label: string; color: string; pulse: boolean }> = {
  disconnected: { label: 'Local Mode',              color: '#acaab0', pulse: false },
  connecting:   { label: 'EchoMind is ready.',       color: '#c799ff', pulse: true },
  connected:    { label: 'Companion is listening.',    color: '#4af8e3', pulse: false },
  reconnecting: { label: 'Context restored.',        color: '#c799ff', pulse: true },
  degraded:     { label: 'Local Mode',              color: '#acaab0', pulse: true },
  offline:      { label: 'Local Mode',              color: '#acaab0', pulse: false },
};

const HEALTH_CONFIG: Record<string, { label: string; color: string }> = {
  healthy:     { label: 'Online',     color: '#4af8e3' },
  degraded:    { label: 'Local Mode', color: '#c799ff' },
  unreachable: { label: 'Local Mode', color: '#acaab0' },
};

function formatTimestamp(ts: number | null): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 5_000) return 'Just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(ts).toLocaleTimeString();
}

// ─── Component ────────────────────────────────────────────────

interface BackendSyncStatusProps {
  syncState: BackendSyncState;
  onForceReconnect?: () => void;
}

export default function BackendSyncStatus({ syncState, onForceReconnect }: BackendSyncStatusProps) {
  const stateViz = STATE_CONFIG[syncState.connectionState] || STATE_CONFIG.disconnected;
  const healthViz = HEALTH_CONFIG[syncState.backendHealth] || HEALTH_CONFIG.unreachable;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="w-full max-w-2xl mx-auto mt-12"
    >
      {/* Section Header */}
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-label text-white/30 whitespace-nowrap">Backend Sync</h2>
        <div className="h-px flex-1 bg-gradient-to-r from-white/8 to-transparent" />
      </div>

      {/* Diagnostic Panel */}
      <div
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '16px',
          backdropFilter: 'blur(20px)',
          padding: '20px 24px',
        }}
      >
        {/* Row 1: Connection State + Backend Health */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          {/* Connection State */}
          <div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
              Connection
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ position: 'relative', width: '8px', height: '8px' }}>
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: stateViz.color,
                  }}
                />
                {stateViz.pulse && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: '-3px',
                      borderRadius: '50%',
                      backgroundColor: stateViz.color,
                      opacity: 0.3,
                      animation: 'pulse 2s ease-in-out infinite',
                    }}
                  />
                )}
              </div>
              <span style={{ fontSize: '13px', color: stateViz.color, fontWeight: 500 }}>
                {stateViz.label}
              </span>
            </div>
          </div>

          {/* Backend Health */}
          <div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
              Backend Health
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: healthViz.color,
                }}
              />
              <span style={{ fontSize: '13px', color: healthViz.color, fontWeight: 500 }}>
                {healthViz.label}
              </span>
            </div>
          </div>
        </div>

        {/* Row 2: Metrics Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '12px',
            padding: '12px 0',
            borderTop: '1px solid rgba(255,255,255,0.04)',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}
        >
          {/* Queued */}
          <div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', marginBottom: '4px' }}>
              Queued
            </div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: 'rgba(255,255,255,0.8)', fontVariantNumeric: 'tabular-nums' }}>
              {syncState.queuedSyncCount}
            </div>
          </div>

          {/* Uploading */}
          <div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', marginBottom: '4px' }}>
              Uploading
            </div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: syncState.pendingUploads > 0 ? '#f59e0b' : 'rgba(255,255,255,0.8)', fontVariantNumeric: 'tabular-nums' }}>
              {syncState.pendingUploads}
            </div>
          </div>

          {/* Latency */}
          <div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', marginBottom: '4px' }}>
              Latency
            </div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: 'rgba(255,255,255,0.8)', fontVariantNumeric: 'tabular-nums' }}>
              {syncState.backendLatencyMs !== null ? `${syncState.backendLatencyMs}ms` : '—'}
            </div>
          </div>
        </div>

        {/* Row 3: Footer info */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px' }}>
          <div style={{ display: 'flex', gap: '20px' }}>
            {/* Last Sync */}
            <div>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)' }}>Last sync: </span>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
                {formatTimestamp(syncState.lastSuccessfulSync)}
              </span>
            </div>

            {/* Reconnect Attempts */}
            {syncState.reconnectAttempts > 0 && (
              <div>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)' }}>Retries: </span>
                <span style={{ fontSize: '11px', color: '#f59e0b' }}>
                  {syncState.reconnectAttempts}
                </span>
              </div>
            )}
          </div>

          {/* Offline badge + reconnect button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {syncState.isOfflineMode && (
              <span
                style={{
                  fontSize: '10px',
                  color: '#ef4444',
                  backgroundColor: 'rgba(239,68,68,0.1)',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  border: '1px solid rgba(239,68,68,0.2)',
                  fontWeight: 500,
                }}
              >
                OFFLINE
              </span>
            )}

            {(syncState.connectionState === 'degraded' || syncState.connectionState === 'offline' || syncState.connectionState === 'disconnected') && onForceReconnect && (
              <button
                onClick={onForceReconnect}
                style={{
                  fontSize: '10px',
                  color: '#c799ff',
                  backgroundColor: 'rgba(199,153,255,0.08)',
                  padding: '3px 10px',
                  borderRadius: '9999px',
                  border: '1px solid rgba(199,153,255,0.2)',
                  cursor: 'pointer',
                  fontWeight: 500,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(199,153,255,0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(199,153,255,0.08)';
                }}
              >
                Retry
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Inline pulse keyframe */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.8); }
        }
      `}</style>
    </motion.section>
  );
}
