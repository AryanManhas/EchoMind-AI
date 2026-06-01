import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, Modal, KeyboardAvoidingView, Platform, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { X, Send, Brain, Mic, MicOff } from 'lucide-react-native';
import { SquishButton } from './SquishButton';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useMemoryAgent } from '../hooks/useMemoryAgent';
import { usePersistentMemory } from '../hooks/usePersistentMemory';
import { useReminderEngine } from '../hooks/useReminderEngine';
import { useEchoMindVoice } from '../hooks/useEchoMindVoice';

interface AskEchoMindSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function AskEchoMindSheet({ visible, onClose }: AskEchoMindSheetProps) {
  const [query, setQuery] = useState('');
  
  const { memories } = usePersistentMemory();
  const { tasks: reminders } = useReminderEngine(memories);
  const { state, response, error, ask, reset } = useMemoryAgent(memories, reminders);
  
  // Lightweight STT integration for voice queries
  const { 
    startInstantRecord, 
    stopInstantRecord, 
    captureMode, 
    partialTranscript,
    sentences
  } = useEchoMindVoice();

  const isListening = captureMode === 'manual_instant';

  // Sync voice input with text input
  useEffect(() => {
    if (isListening) {
      const activeText = partialTranscript || (sentences.length > 0 ? sentences[sentences.length - 1] : '');
      if (activeText) setQuery(activeText);
    }
  }, [isListening, partialTranscript, sentences]);

  const handleSend = () => {
    if (isListening) stopInstantRecord();
    ask(query);
  };

  const handleMicPress = () => {
    if (isListening) {
      stopInstantRecord();
    } else {
      setQuery('');
      reset();
      startInstantRecord();
    }
  };

  const handleClose = () => {
    if (isListening) stopInstantRecord();
    reset();
    setQuery('');
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={styles.container}
      >
        <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={handleClose} />
        </Animated.View>

        <Animated.View entering={SlideInDown.springify().damping(20)} exiting={SlideOutDown} style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Brain color="#c799ff" size={24} />
              <Text style={styles.title}>Ask EchoMind</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <X color="#acaab0" size={20} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
            {state === 'idle' ? (
              <View style={styles.idleState}>
                <Text style={styles.idleText}>What would you like to know from your memories?</Text>
                <View style={styles.suggestions}>
                  {["What did we discuss about deployment?", "Show me my pending tasks", "Any meetings today?"].map(s => (
                    <TouchableOpacity key={s} style={styles.suggestionChip} onPress={() => { setQuery(s); ask(s); }}>
                      <Text style={styles.suggestionText}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.responseCard}>
                <Text style={styles.queryEcho}>You asked: "{query}"</Text>
                
                {state === 'searching' || state === 'thinking' ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color="#4af8e3" size="small" />
                    <Text style={styles.loadingText}>
                      {state === 'searching' ? 'Searching vault...' : 'EchoMind is thinking...'}
                    </Text>
                  </View>
                ) : null}

                {(state === 'streaming' || state === 'completed') ? (
                  <View style={styles.answerContainer}>
                    <Text style={styles.answerText}>{response}</Text>
                  </View>
                ) : null}

                {state === 'error' && (
                  <Text style={styles.errorText}>{error}</Text>
                )}
              </View>
            )}
          </ScrollView>

          <View style={styles.inputArea}>
            <TextInput
              style={styles.input}
              placeholder="Ask about your memories..."
              placeholderTextColor="#666"
              value={query}
              onChangeText={(text) => {
                if (isListening) stopInstantRecord();
                setQuery(text);
              }}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              multiline
              maxLength={200}
            />
            
            <View style={styles.actionRow}>
              <TouchableOpacity 
                style={[styles.micButton, isListening && styles.micButtonActive]} 
                onPress={handleMicPress}
              >
                {isListening ? <MicOff color="#ef4444" size={20} /> : <Mic color="#acaab0" size={20} />}
              </TouchableOpacity>
              
              <SquishButton 
                contentContainerStyle={[styles.sendButton, !query.trim() && styles.sendButtonDisabled]}
                onPress={handleSend}
                disabled={!query.trim()}
              >
                <Send color={query.trim() ? "#0e0e12" : "#666"} size={20} />
              </SquishButton>
            </View>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: '#16161a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    minHeight: '60%',
    maxHeight: '90%',
    paddingTop: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 20, fontWeight: '700', color: '#fcf8fe' },
  closeButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1 },
  contentContainer: { paddingHorizontal: 24, paddingBottom: 20 },
  idleState: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 40 },
  idleText: { color: '#acaab0', fontSize: 16, marginBottom: 24, textAlign: 'center' },
  suggestions: { gap: 12, width: '100%' },
  suggestionChip: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  suggestionText: { color: '#4af8e3', fontSize: 14, fontWeight: '500' },
  responseCard: { backgroundColor: 'rgba(255,255,255,0.03)', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  queryEcho: { color: '#acaab0', fontSize: 14, fontStyle: 'italic', marginBottom: 16 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  loadingText: { color: '#4af8e3', fontSize: 14, fontWeight: '500' },
  answerContainer: { marginTop: 10 },
  answerText: { color: '#fcf8fe', fontSize: 16, lineHeight: 24 },
  errorText: { color: '#ef4444', fontSize: 14, marginTop: 10 },
  inputArea: {
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    backgroundColor: '#0e0e12',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    color: '#fcf8fe',
    fontSize: 15,
    minHeight: 44,
    maxHeight: 100,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 2 },
  micButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  micButtonActive: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', borderWidth: 1 },
  sendButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#4af8e3', justifyContent: 'center', alignItems: 'center' },
  sendButtonDisabled: { backgroundColor: 'rgba(255,255,255,0.1)' }
});
