import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { OrbVisualizer } from '../../components/OrbVisualizer';
import { Wifi, WifiOff, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useEchoMindVoice } from '../../hooks/useEchoMindVoice';
import { EchoMindSocket } from '../../lib/socket';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

const { width } = Dimensions.get('window');

export default function ListenerScreen() {
  const { isRecording, audioLevel, partialTranscript, sentences, error: voiceError, startRecording, stopRecording } = useEchoMindVoice();
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [memoryStatus, setMemoryStatus] = useState<'idle' | 'analyzing' | 'saved'>('idle');

  useEffect(() => {
    const socket = EchoMindSocket.getInstance();

    const onConnecting = () => setWsStatus('connecting');
    const onConnected = () => setWsStatus('connected');
    const onDisconnected = () => setWsStatus('disconnected');
    const onStatusChange = (data: any) => {
      if (data.status === 'analyzing') setMemoryStatus('analyzing');
    };
    const onMemorySaved = () => {
      setMemoryStatus('saved');
      setTimeout(() => {
        setMemoryStatus(current => current === 'saved' ? 'idle' : current);
      }, 2000);
    };

    socket.on('connecting', onConnecting);
    socket.on('connected', onConnected);
    socket.on('disconnected', onDisconnected);
    socket.on('reconnect_failed', onDisconnected);
    socket.on('STATUS_CHANGE', onStatusChange);
    socket.on('MEMORY_SAVED', onMemorySaved);

    socket.connect();

    return () => {
      socket.off('connecting', onConnecting);
      socket.off('connected', onConnected);
      socket.off('disconnected', onDisconnected);
      socket.off('reconnect_failed', onDisconnected);
      socket.off('STATUS_CHANGE', onStatusChange);
      socket.off('MEMORY_SAVED', onMemorySaved);
    };
  }, []);

  const handleRetryConnection = useCallback(() => {
    EchoMindSocket.getInstance().retry();
  }, []);

  const latestSentence = sentences.length > 0 ? sentences[sentences.length - 1] : '';
  const displayTranscript = partialTranscript || latestSentence || 'Tap the orb to start...';

  return (
    <View style={styles.container}>
      {/* Background gradient */}
      <LinearGradient
        colors={['rgba(199, 153, 255, 0.08)', 'rgba(74, 248, 227, 0.04)', 'transparent']}
        style={styles.bgGradient}
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Connection Status Bar */}
        <View style={styles.statusRow}>
          <TouchableOpacity
            style={[
              styles.statusPill,
              wsStatus === 'connected' && styles.statusConnected,
              wsStatus === 'disconnected' && styles.statusDisconnected,
            ]}
            onPress={wsStatus === 'disconnected' ? handleRetryConnection : undefined}
            activeOpacity={wsStatus === 'disconnected' ? 0.7 : 1}
          >
            {wsStatus === 'connected' ? (
              <Wifi color="#4af8e3" size={12} />
            ) : wsStatus === 'connecting' ? (
              <RefreshCw color="#c799ff" size={12} />
            ) : (
              <WifiOff color="#ef4444" size={12} />
            )}
            <Text style={styles.statusText}>
              {wsStatus === 'connected' ? 'SYNCED' : wsStatus === 'connecting' ? 'CONNECTING...' : 'OFFLINE · TAP TO RETRY'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Orb */}
        <View style={styles.orbContainer}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={isRecording ? stopRecording : startRecording}
          >
            <OrbVisualizer isRecording={isRecording} audioLevel={audioLevel} />
          </TouchableOpacity>
        </View>

        {/* Voice Error */}
        {voiceError && (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.errorBanner}>
            <AlertCircle color="#ef4444" size={16} />
            <Text style={styles.errorText}>{voiceError}</Text>
          </Animated.View>
        )}

        {/* Live Transcript */}
        {isRecording && (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.transcriptBox}>
            <Text style={styles.transcriptText} numberOfLines={4}>
              {displayTranscript}
            </Text>
          </Animated.View>
        )}

        {/* Memory Extraction Status */}
        {memoryStatus !== 'idle' && (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.memoryStatusRow}>
            <View style={styles.memoryPill}>
              {memoryStatus === 'analyzing' ? (
                <>
                  <RefreshCw color="#c799ff" size={14} />
                  <Text style={[styles.memoryStatusText, { color: '#c799ff' }]}>Extracting Memory...</Text>
                </>
              ) : (
                <>
                  <CheckCircle color="#4af8e3" size={14} />
                  <Text style={[styles.memoryStatusText, { color: '#4af8e3' }]}>Memory Saved ✓</Text>
                </>
              )}
            </View>
          </Animated.View>
        )}

        {/* Idle State CTA */}
        {!isRecording && memoryStatus === 'idle' && (
          <View style={styles.idleContainer}>
            <Text style={styles.heroTitle}>
              Your AI Memory
            </Text>
            <LinearGradient
              colors={['#c799ff', '#4af8e3']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.gradientLine}
            />
            <Text style={styles.heroSubtitle}>
              Tap the orb and speak naturally.{'\n'}
              EchoMind will remember everything for you.
            </Text>
          </View>
        )}

        {/* Live Sentence Feed */}
        {sentences.length > 0 && (
          <View style={styles.sentencesContainer}>
            <Text style={styles.sentencesLabel}>
              {isRecording ? '● Live feed' : 'Recent transcripts'}
            </Text>
            {sentences.slice(-5).map((s, i) => (
              <Animated.View key={`${sentences.length}-${i}`} entering={FadeIn} style={styles.sentenceBubble}>
                <Text style={styles.sentenceText} numberOfLines={2}>{s}</Text>
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0e0e12',
  },
  bgGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '60%',
    borderBottomLeftRadius: 200,
    borderBottomRightRadius: 200,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: 100,
    paddingBottom: 140,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(14, 14, 18, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  statusConnected: {
    borderColor: 'rgba(74, 248, 227, 0.3)',
  },
  statusDisconnected: {
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#acaab0',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  orbContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 24,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  errorText: {
    flex: 1,
    color: '#fca5a5',
    fontSize: 13,
    lineHeight: 18,
  },
  transcriptBox: {
    marginTop: 24,
    paddingHorizontal: 32,
    alignItems: 'center',
    minHeight: 80,
  },
  transcriptText: {
    fontSize: 20,
    fontWeight: '500',
    color: '#fcf8fe',
    textAlign: 'center',
    lineHeight: 30,
  },
  memoryStatusRow: {
    marginTop: 20,
    alignItems: 'center',
  },
  memoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  memoryStatusText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  idleContainer: {
    alignItems: 'center',
    paddingHorizontal: 32,
    marginTop: 32,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fcf8fe',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  gradientLine: {
    width: 80,
    height: 3,
    borderRadius: 2,
    marginVertical: 16,
  },
  heroSubtitle: {
    fontSize: 16,
    color: '#acaab0',
    textAlign: 'center',
    lineHeight: 24,
    opacity: 0.8,
  },
  sentencesContainer: {
    marginTop: 32,
    paddingHorizontal: 24,
  },
  sentencesLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4af8e3',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  sentenceBubble: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 14,
    marginBottom: 8,
  },
  sentenceText: {
    color: '#acaab0',
    fontSize: 14,
    lineHeight: 20,
  },
});
