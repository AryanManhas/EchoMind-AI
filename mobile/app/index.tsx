import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Dimensions
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import {
  Mic,
  Bell,
  Zap,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  CheckCircle,
  Wifi,
  WifiOff
} from 'lucide-react-native';
import Animated, {
  FadeIn,
  SlideInRight,
  SlideOutLeft
} from 'react-native-reanimated';
import { useBackendHealth } from '../hooks/useBackendHealth';

const { width } = Dimensions.get('window');
const ONBOARDING_KEY = '@EchoMind:OnboardingCompleted';

type OnboardingStep = 'welcome' | 'permissions' | 'microphone' | 'backend' | 'demo' | 'ready';

export default function GatekeeperScreen() {
  const router = useRouter();
  const backendHealth = useBackendHealth();
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [micStatus, setMicStatus] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [notifyStatus, setNotifyStatus] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [permissionRetryCount, setPermissionRetryCount] = useState(0);
  const [backendChecking, setBackendChecking] = useState(false);

  // Check if already completed onboarding
  useEffect(() => {
    async function checkState() {
      try {
        const value = await AsyncStorage.getItem(ONBOARDING_KEY);
        if (value === 'true') {
          router.replace('/(tabs)/listener');
        } else {
          setChecking(false);
        }
      } catch (err) {
        setChecking(false);
      }
    }
    checkState();
  }, [router]);

  useEffect(() => {
    let mounted = true;
    async function loadPermissionState() {
      const mic = await Audio.getPermissionsAsync();
      const notify = await Notifications.getPermissionsAsync();
      if (!mounted) return;
      setMicStatus(mic.status === 'granted' ? 'granted' : mic.status === 'denied' ? 'denied' : 'prompt');
      setNotifyStatus(notify.status === 'granted' ? 'granted' : notify.status === 'denied' ? 'denied' : 'prompt');
    }
    void loadPermissionState();
    return () => {
      mounted = false;
    };
  }, []);

  // Request Microphone Permission
  const handleRequestMicrophone = async () => {
    try {
      setPermissionRetryCount(count => count + 1);
      const { status } = await Audio.requestPermissionsAsync();
      if (status === 'granted') {
        setMicStatus('granted');
        setStep('backend');
      } else {
        setMicStatus('denied');
      }
    } catch (err) {
      console.warn('[Onboarding] Mic permission error:', err);
    }
  };

  // Request Notifications Permission
  const handleRequestNotifications = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        setNotifyStatus('granted');
      } else {
        setNotifyStatus('denied');
      }
      setStep('microphone');
    } catch (err) {
      console.warn('[Onboarding] Notification permission error:', err);
      setStep('microphone');
    }
  };

  const handleCheckBackend = useCallback(async () => {
    setBackendChecking(true);
    try {
      await backendHealth.checkBackendHealth();
    } finally {
      setBackendChecking(false);
      setStep('demo');
    }
  }, [backendHealth]);

  const handleSkipOnboarding = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      router.replace('/(tabs)/listener');
    } catch {
      router.replace('/(tabs)/listener');
    }
  };

  const handleOpenSettings = async () => {
    try {
      await Linking.openSettings();
    } catch (err) {
      console.warn('[Onboarding] Error opening settings:', err);
    }
  };

  // Finish Onboarding
  const handleCompleteOnboarding = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      router.replace('/(tabs)/listener');
    } catch (err) {
      console.error('[Onboarding] Failed to save completed state:', err);
    }
  };

  if (checking) {
    return (
      <View style={styles.loadingContainer}>
        <LinearGradient
          colors={['#0e0e12', '#08080a']}
          style={StyleSheet.absoluteFill}
        />
        <ActivityIndicator size="large" color="#c799ff" />
        <Text style={styles.loadingText}>Synchronizing mind states...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['rgba(199, 153, 255, 0.08)', 'rgba(74, 248, 227, 0.04)', 'transparent']}
        style={styles.bgGradient}
      />

      {step === 'welcome' && (
        <Animated.View
          entering={FadeIn.duration(400)}
          exiting={SlideOutLeft}
          style={styles.card}
        >
          <View style={styles.iconContainer}>
            <Sparkles color="#c799ff" size={48} />
          </View>
          <Text style={styles.title}>Welcome to EchoMind AI</Text>
          <Text style={styles.description}>
            A bilingual (English + Hindi), local-first conversational voice assistant with persistent neural memory and real-time reminders.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => setStep('permissions')}
          >
            <LinearGradient
              colors={['#c799ff', '#a78bfa']}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <Text style={styles.primaryButtonText}>Begin Setup</Text>
            <ArrowRight color="#0e0e12" size={18} strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkButton} onPress={handleSkipOnboarding}>
            <Text style={styles.skipButtonText}>Skip setup</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {step === 'permissions' && (
        <Animated.View
          entering={SlideInRight}
          exiting={SlideOutLeft}
          style={styles.card}
        >
          <View style={[styles.iconContainer, { borderColor: '#c799ff' }]}>
            <Bell color="#c799ff" size={48} />
          </View>
          <Text style={styles.title}>Permissions</Text>
          <Text style={styles.description}>
            Notifications are optional for reminders. Microphone access is needed before voice capture can start.
          </Text>

          <View style={styles.infoCard}>
            <Bell color={notifyStatus === 'granted' ? '#10b981' : '#c799ff'} size={16} />
            <Text style={styles.infoText}>Reminders: {notifyStatus === 'granted' ? 'enabled' : 'can be enabled now or later'}</Text>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={micStatus === 'granted' ? () => setStep('backend') : handleRequestMicrophone}
          >
            <LinearGradient
              colors={['#c799ff', '#a78bfa']}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <Text style={styles.primaryButtonText}>{notifyStatus === 'granted' ? 'Continue' : 'Enable Alerts'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkButton} onPress={() => setStep('microphone')}>
            <Text style={styles.skipButtonText}>Skip alerts</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {step === 'microphone' && (
        <Animated.View
          entering={SlideInRight}
          exiting={SlideOutLeft}
          style={styles.card}
        >
          <View style={[styles.iconContainer, { borderColor: '#4af8e3' }]}>
            <Mic color="#4af8e3" size={48} />
          </View>
          <Text style={styles.title}>Microphone</Text>
          <Text style={styles.description}>
            EchoMind uses the microphone for local listening and conversation capture. It does not need backend connectivity for core memory and reminders.
          </Text>

          {micStatus === 'denied' && (
            <Text style={styles.warningText}>
              Microphone access is blocked. You can open settings or continue in read-only local mode.
            </Text>
          )}

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleRequestNotifications}
          >
            <LinearGradient
              colors={['#4af8e3', '#3de0cf']}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <Text style={styles.primaryButtonText}>
              {micStatus === 'granted' ? 'Continue' : 'Grant Microphone Access'}
            </Text>
          </TouchableOpacity>
          {!!(micStatus === 'denied' && permissionRetryCount > 0) && (
            <TouchableOpacity style={styles.linkButton} onPress={handleOpenSettings}>
              <Text style={styles.linkButtonText}>Open System Settings</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.linkButton} onPress={() => setStep('backend')}>
            <Text style={styles.skipButtonText}>Continue without microphone</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {step === 'backend' && (
        <Animated.View
          entering={SlideInRight}
          exiting={SlideOutLeft}
          style={styles.card}
        >
          <View style={[styles.iconContainer, { borderColor: backendHealth.backendHealth === 'healthy' ? '#10b981' : '#fbbf24' }]}>
            {backendHealth.backendHealth === 'healthy' ? (
              <Wifi color="#10b981" size={48} />
            ) : (
              <WifiOff color="#fbbf24" size={48} />
            )}
          </View>
          <Text style={styles.title}>Cloud Link</Text>
          <Text style={styles.description}>
            Cloud sync is optional. EchoMind continues to operate intelligently as a local companion when offline, syncing memories when the connection is restored.
          </Text>
          <View style={styles.infoCard}>
            {backendHealth.backendHealth === 'healthy' ? (
              <CheckCircle color="#10b981" size={16} />
            ) : (
              <WifiOff color="#fbbf24" size={16} />
            )}
            <Text style={styles.infoText}>
              {backendHealth.backendHealth === 'healthy'
                ? `Cloud Ready${backendHealth.backendLatencyMs != null ? ` · ${backendHealth.backendLatencyMs}ms` : ''}`
                : 'Local companion is ready.'}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleCheckBackend}
            disabled={backendChecking}
          >
            <LinearGradient
              colors={['#fbbf24', '#f59e0b']}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            {backendChecking ? (
              <ActivityIndicator color="#0e0e12" />
            ) : (
              <Text style={[styles.primaryButtonText, { color: '#0e0e12' }]}>Check Connection</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.linkButton} onPress={() => setStep('demo')}>
            <Text style={styles.skipButtonText}>Continue with local companion</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {step === 'demo' && (
        <Animated.View
          entering={SlideInRight}
          exiting={SlideOutLeft}
          style={styles.card}
        >
          <View style={[styles.iconContainer, { borderColor: '#4af8e3' }]}>
            <Zap color="#4af8e3" size={48} />
          </View>
          <Text style={styles.title}>Experience EchoMind</Text>
          <Text style={styles.description}>
            Try saying: "Hey EchoMind, remind me to call Rahul tomorrow." The assistant will listen, capture the context, and seamlessly create a proactive reminder.
          </Text>
          <View style={styles.infoCard}>
            <Mic color="#4af8e3" size={16} />
            <Text style={styles.infoText}>Tap the orb to start, or hold it for instant recording.</Text>
          </View>
          <TouchableOpacity style={styles.primaryButton} onPress={() => setStep('ready')}>
            <LinearGradient
              colors={['#4af8e3', '#3de0cf']}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <Text style={styles.primaryButtonText}>Finish Setup</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {step === 'ready' && (
        <Animated.View
          entering={SlideInRight}
          style={styles.card}
        >
          <View style={[styles.iconContainer, { borderColor: '#10b981' }]}>
            <ShieldCheck color="#10b981" size={48} />
          </View>
          <Text style={styles.title}>Everything is Ready!</Text>
          <Text style={styles.description}>
            EchoMind is fully configured and ready to accompany you. Wake it up by speaking "Hey EchoMind" or tapping the central neural orb.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleCompleteOnboarding}
          >
            <LinearGradient
              colors={['#10b981', '#059669']}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <Text style={styles.primaryButtonText}>Get Started</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#acaab0',
    fontSize: 14,
    marginTop: 16,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  container: {
    flex: 1,
    backgroundColor: '#0e0e12',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  bgGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '100%',
  },
  card: {
    width: '100%',
    maxWidth: width - 48,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fcf8fe',
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  description: {
    fontSize: 14,
    color: '#acaab0',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  warningText: {
    fontSize: 12,
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 12,
  },
  primaryButton: {
    width: '100%',
    height: 54,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0e0e12',
    letterSpacing: 0.2,
  },
  linkButton: {
    marginTop: 16,
    paddingVertical: 8,
  },
  linkButtonText: {
    color: '#c799ff',
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  skipButtonText: {
    color: 'rgba(252, 248, 254, 0.4)',
    fontSize: 13,
    fontWeight: '600',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(251, 191, 36, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.15)',
    padding: 12,
    gap: 10,
    marginBottom: 24,
  },
  infoText: {
    color: '#fbbf24',
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
    fontWeight: '500',
  },
});
