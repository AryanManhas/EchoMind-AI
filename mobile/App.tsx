import React, { useEffect, useRef } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  FlatList,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Mic, MicOff, Bluetooth, BluetoothConnected } from 'lucide-react-native';
import NeuralOrb from './components/NeuralOrb';
import { useEchoMindVoice } from './hooks/useEchoMindVoice';
import { useBluetoothAudio } from './hooks/useBluetoothAudio';

const App = () => {
  const {
    isRecording, 
    sentences, 
    partialTranscript, 
    audioLevel, 
    error, 
    startRecording, 
    stopRecording 
  } = useEchoMindVoice();
  
  const { isBluetoothConnected } = useBluetoothAudio();
  const flatListRef = useRef<FlatList>(null);

  const backgroundStyle = {
    backgroundColor: '#050505', // Deep Black for OLED
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={[styles.safeArea, backgroundStyle]}>
        <StatusBar barStyle="light-content" backgroundColor="#050505" />

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>EchoMind AI</Text>
          <View style={styles.headerActions}>
             {isBluetoothConnected ? (
               <BluetoothConnected color="#00F2FF" size={24} />
             ) : (
               <Bluetooth color="#4A5568" size={24} />
             )}
          </View>
        </View>

        {/* Neural visualizer section */}
        <View style={styles.orbContainer}>
          <NeuralOrb scale={audioLevel} isRecording={isRecording} />
          <Text style={styles.statusText}>
            {isRecording ? 'NEURAL LINK ACTIVE' : 'READY FOR INPUT'}
          </Text>
        </View>

        {/* Transcript Scrolling List */}
        <View style={styles.transcriptContainer}>
          <FlatList
            ref={flatListRef}
            data={sentences}
            keyExtractor={(item, index) => index.toString()}
            renderItem={({ item }) => (
              <View style={styles.sentenceBubble}>
                <Text style={styles.sentenceText}>{item}</Text>
              </View>
            )}
            ListFooterComponent={
              partialTranscript ? (
                <View style={styles.partialBubble}>
                   <Text style={styles.partialText}>{partialTranscript}</Text>
                </View>
              ) : null
            }
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            contentContainerStyle={styles.scrollContent}
          />
        </View>

        {/* Error Banner */}
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Primary Control */}
        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.micButton, isRecording && styles.micButtonActive]}
            onPress={isRecording ? stopRecording : startRecording}
            activeOpacity={0.7}
          >
            {isRecording ? (
              <MicOff color="#FFFFFF" size={36} />
            ) : (
              <Mic color="#FFFFFF" size={36} />
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logo: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orbContainer: {
    height: 300,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: {
    marginTop: 40,
    color: '#00F2FF',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 5,
    opacity: 0.9,
  },
  transcriptContainer: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  scrollContent: {
    padding: 20,
  },
  sentenceBubble: {
    marginBottom: 16,
    padding: 12,
  },
  sentenceText: {
    color: '#CBD5E0',
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '300',
  },
  partialBubble: {
    padding: 12,
    opacity: 0.6,
  },
  partialText: {
    color: '#00F2FF',
    fontSize: 18,
    lineHeight: 26,
    fontStyle: 'italic',
  },
  errorBanner: {
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    marginHorizontal: 20,
    padding: 10,
    borderRadius: 10,
    marginBottom: 10,
    alignItems: 'center',
  },
  errorText: {
    color: '#FF4D4D',
    fontSize: 12,
    fontWeight: '600',
  },
  controls: {
    paddingBottom: 50,
    alignItems: 'center',
  },
  micButton: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#4B0082', // Deep Violet
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4B0082',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 15,
  },
  micButtonActive: {
    backgroundColor: '#FF0055',
    shadowColor: '#FF0055',
  },
});

export default App;
