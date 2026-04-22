import React, { useEffect, useRef } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  FlatList,
  Platform,
} from 'react-native';

import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Mic, MicOff } from 'lucide-react-native';
import { requestMultiple, PERMISSIONS } from 'react-native-permissions';

import NeuralOrb from './components/NeuralOrb';
import WaveformVisualizer from './components/WaveformVisualizer';

import { useEchoMindVoice } from './hooks/useEchoMindVoice';
import { useBluetoothAudio } from './hooks/useBluetoothAudio';

const COLORS = {
  bg: '#050505',
  surface: '#0A0F1C',
  primary: '#00F2FF',
  accent: '#FF0055',
  text: '#E2E8F0',
  muted: '#94A3B8',
};

const App = () => {
  const {
    isRecording,
    sentences,
    partialTranscript,
    audioLevel,
    error,
    startRecording,
    stopRecording,
  } = useEchoMindVoice();

  const { isBluetoothConnected, deviceName } = useBluetoothAudio();
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    const permissions = Platform.select({
      android: [
        PERMISSIONS.ANDROID.RECORD_AUDIO,
        PERMISSIONS.ANDROID.BLUETOOTH_CONNECT,
        PERMISSIONS.ANDROID.BLUETOOTH_SCAN,
      ],
      ios: [
        PERMISSIONS.IOS.MICROPHONE,
        PERMISSIONS.IOS.BLUETOOTH,
      ],
    }) || [];

    requestMultiple(permissions);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />

        {/* HEADER */}
        <View style={styles.header}>
          <View>
            <Text style={styles.logo}>ECHOMIND</Text>
            <Text style={styles.subtitle}>Neural Interface</Text>
          </View>

          <View style={styles.deviceWrap}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isBluetoothConnected ? COLORS.primary : '#555' },
              ]}
            />
            <Text style={styles.deviceText}>
              {isBluetoothConnected ? deviceName : 'No Device'}
            </Text>
          </View>
        </View>

        {/* ORB */}
        <View style={styles.orbSection}>
          <View style={styles.outerGlow} />
          <View style={styles.innerGlow} />

          <NeuralOrb scale={audioLevel} isRecording={isRecording} />

          <Text style={styles.statusText}>
            {isRecording ? '● LISTENING' : '● IDLE'}
          </Text>

          <WaveformVisualizer
            audioLevel={audioLevel}
            isRecording={isRecording}
          />
        </View>

        {/* CHAT */}
        <View style={styles.chatContainer}>
          {sentences.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Tap mic to activate EchoMind
              </Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={sentences}
              keyExtractor={(item, index) => index.toString()}
              renderItem={({ item }) => (
                <View style={styles.bubble}>
                  <Text style={styles.bubbleText}>{item}</Text>
                </View>
              )}
              ListFooterComponent={
                partialTranscript ? (
                  <Text style={styles.partial}>{partialTranscript}</Text>
                ) : null
              }
              onContentSizeChange={() =>
                flatListRef.current?.scrollToEnd({ animated: true })
              }
            />
          )}
        </View>

        {/* MIC BUTTON */}
        <View style={styles.controls}>
          <View style={styles.micWrapper}>
            <View style={styles.micOuterRing} />
            <View style={styles.micGlow} />

            <TouchableOpacity
              style={[
                styles.micButton,
                isRecording && { backgroundColor: COLORS.accent },
              ]}
              onPress={isRecording ? stopRecording : startRecording}
            >
              {isRecording ? (
                <MicOff size={30} color="#fff" />
              ) : (
                <Mic size={30} color="#fff" />
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.micLabel}>
            {isRecording ? 'STOP' : 'ACTIVATE'}
          </Text>
        </View>

        {/* ERROR */}
        {error && <Text style={styles.error}>{error}</Text>}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
};

export default App;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  header: {
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  logo: {
    fontSize: 20,
    color: COLORS.primary,
    letterSpacing: 4,
  },

  subtitle: {
    fontSize: 10,
    color: COLORS.muted,
    letterSpacing: 2,
  },

  deviceWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },

  deviceText: {
    color: COLORS.muted,
    fontSize: 10,
  },

  orbSection: {
    alignItems: 'center',
    marginTop: 30,
  },

  outerGlow: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: COLORS.primary,
    opacity: 0.05,
  },

  innerGlow: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: COLORS.primary,
    opacity: 0.08,
  },

  statusText: {
    marginTop: 20,
    color: COLORS.primary,
    fontSize: 12,
    letterSpacing: 2,
  },

  chatContainer: {
    flex: 1,
    marginTop: 20,
  },

  bubble: {
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  bubbleText: {
    color: COLORS.text,
    fontSize: 16,
  },

  partial: {
    color: COLORS.primary,
    marginLeft: 16,
    fontStyle: 'italic',
  },

  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  emptyText: {
    color: COLORS.muted,
  },

  controls: {
    alignItems: 'center',
    marginBottom: 40,
  },

  micWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  micOuterRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: 'rgba(0,242,255,0.3)',
  },

  micGlow: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: COLORS.primary,
    opacity: 0.05,
  },

  micButton: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#4B0082',
    justifyContent: 'center',
    alignItems: 'center',
  },

  micLabel: {
    marginTop: 10,
    color: COLORS.primary,
    fontSize: 10,
    letterSpacing: 2,
  },

  error: {
    color: 'red',
    textAlign: 'center',
    marginBottom: 10,
  },
});