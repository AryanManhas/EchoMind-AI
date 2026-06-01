/**
 * OrbVisualizer — Premium animated orb with 7 capture-state visual modes.
 *
 * States:  idle | passive_listening | speech_detected | recording | processing | saved | error
 *
 * animationProfile:
 *  - 'idle-only'   — float loop + idle transitions only
 *  - 'validation'  — idle / passive / processing / recording (+ optional audioLevel)
 *  - 'full'        — production state machine
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useAnimatedReaction,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
  withSpring,
  withDelay,
  Easing,
  Extrapolation,
  interpolate,
  cancelAnimation,
  type SharedValue,
} from 'react-native-reanimated';

/** UI-thread EMA factor — single smoothing authority (no per-frame withSpring). */
const AUDIO_LEVEL_SMOOTH_ALPHA = 0.12;
import {
  Mic,
  MicOff,
  Radio,
  Ear,
  Loader,
  CheckCircle,
  AlertCircle,
  ShieldAlert,
  Users,
  MessageCircle,
  Sparkles,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { VoiceCaptureState, CaptureMode } from '../hooks/useEchoMindVoice';

// ─── State Config ───────────────────────────────────────────────────────────

interface StateVisual {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  gradientColors: readonly [string, string, string];
  glowColor: string;
  dotColor: string;
  borderColor: string;
}

const STATE_VISUALS: Record<VoiceCaptureState | 'activation_detected' | 'listening' | 'thinking' | 'interrupted', StateVisual> = {
  idle: {
    icon: <MicOff color="rgba(252, 248, 254, 0.2)" size={38} strokeWidth={1} />,
    label: 'EchoMind',
    sublabel: 'Ready',
    gradientColors: ['rgba(255,255,255,0.01)', 'rgba(255,255,255,0.005)', 'transparent'],
    glowColor: 'rgba(255, 255, 255, 0.015)',
    dotColor: '#444',
    borderColor: 'rgba(255, 255, 255, 0.02)',
  },
  passive_listening: {
    icon: <Ear color="#c799ff" size={38} strokeWidth={1} />,
    label: 'Ambient',
    sublabel: 'Listening',
    gradientColors: ['rgba(199,153,255,0.04)', 'rgba(139,92,246,0.015)', 'transparent'],
    glowColor: 'rgba(199, 153, 255, 0.05)',
    dotColor: '#c799ff',
    borderColor: 'rgba(199, 153, 255, 0.08)',
  },
  speech_detected: {
    icon: <Radio color="#c7baff" size={38} strokeWidth={1} />,
    label: 'Hearing you',
    sublabel: 'Capturing',
    gradientColors: ['rgba(199,186,255,0.05)', 'rgba(167,139,250,0.02)', 'transparent'],
    glowColor: 'rgba(199, 186, 255, 0.08)',
    dotColor: '#c7baff',
    borderColor: 'rgba(199, 186, 255, 0.1)',
  },
  recording: {
    icon: <Mic color="#4af8e3" size={40} strokeWidth={1} />,
    label: 'Listening',
    sublabel: 'Active',
    gradientColors: ['rgba(74,248,227,0.05)', 'rgba(199,153,255,0.02)', 'transparent'],
    glowColor: 'rgba(74, 248, 227, 0.08)',
    dotColor: '#4af8e3',
    borderColor: 'rgba(74, 248, 227, 0.1)',
  },
  processing: {
    icon: <Loader color="#c799ff" size={38} strokeWidth={1} />,
    label: 'Thinking',
    sublabel: 'Processing',
    gradientColors: ['rgba(199,153,255,0.05)', 'rgba(74,248,227,0.02)', 'transparent'],
    glowColor: 'rgba(199, 153, 255, 0.08)',
    dotColor: '#c799ff',
    borderColor: 'rgba(199, 153, 255, 0.08)',
  },
  responding: {
    icon: <MessageCircle color="#93c5fd" size={38} strokeWidth={1} />,
    label: 'EchoMind',
    sublabel: 'Speaking',
    gradientColors: ['rgba(147,197,253,0.05)', 'rgba(59,130,246,0.02)', 'transparent'],
    glowColor: 'rgba(147, 197, 253, 0.08)',
    dotColor: '#93c5fd',
    borderColor: 'rgba(147, 197, 253, 0.1)',
  },
  saved: {
    icon: <CheckCircle color="#6ee7b7" size={40} strokeWidth={1} />,
    label: 'Saved',
    sublabel: 'Memory stored',
    gradientColors: ['rgba(110,231,183,0.05)', 'rgba(16,185,129,0.02)', 'transparent'],
    glowColor: 'rgba(110, 231, 183, 0.08)',
    dotColor: '#6ee7b7',
    borderColor: 'rgba(110, 231, 183, 0.1)',
  },
  error: {
    icon: <AlertCircle color="#fca5a5" size={38} strokeWidth={1} />,
    label: 'Issue detected',
    sublabel: 'Error',
    gradientColors: ['rgba(252,165,165,0.04)', 'rgba(239,68,68,0.02)', 'transparent'],
    glowColor: 'rgba(252, 165, 165, 0.05)',
    dotColor: '#fca5a5',
    borderColor: 'rgba(252, 165, 165, 0.08)',
  },
  consent_required: {
    icon: <ShieldAlert color="#fcd34d" size={38} strokeWidth={1} />,
    label: 'Consent needed',
    sublabel: 'Privacy',
    gradientColors: ['rgba(252,211,77,0.04)', 'rgba(245,158,11,0.02)', 'transparent'],
    glowColor: 'rgba(252, 211, 77, 0.05)',
    dotColor: '#fcd34d',
    borderColor: 'rgba(252, 211, 77, 0.08)',
  },
  activation_detected: {
    icon: <Sparkles color="#4af8e3" size={38} strokeWidth={1} />,
    label: 'Yes?',
    sublabel: 'Activated',
    gradientColors: ['rgba(74,248,227,0.05)', 'rgba(199,153,255,0.02)', 'transparent'],
    glowColor: 'rgba(74, 248, 227, 0.08)',
    dotColor: '#4af8e3',
    borderColor: 'rgba(74, 248, 227, 0.1)',
  },
  listening: {
    icon: <Mic color="#4af8e3" size={44} strokeWidth={1.5} />,
    label: 'Listening...',
    sublabel: 'Active',
    gradientColors: ['rgba(74,248,227,0.08)', 'rgba(199,153,255,0.04)', 'transparent'],
    glowColor: 'rgba(74, 248, 227, 0.15)',
    dotColor: '#4af8e3',
    borderColor: 'rgba(74, 248, 227, 0.15)',
  },
  thinking: {
    icon: <Loader color="#c799ff" size={42} strokeWidth={1.5} />,
    label: 'Thinking...',
    sublabel: 'Processing',
    gradientColors: ['rgba(199,153,255,0.08)', 'rgba(74,248,227,0.03)', 'transparent'],
    glowColor: 'rgba(199, 153, 255, 0.12)',
    dotColor: '#c799ff',
    borderColor: 'rgba(199, 153, 255, 0.15)',
  },
  interrupted: {
    icon: <MicOff color="#fca5a5" size={42} strokeWidth={1.5} />,
    label: 'Interrupted',
    sublabel: 'Stopped',
    gradientColors: ['rgba(252,165,165,0.08)', 'rgba(239,68,68,0.03)', 'transparent'],
    glowColor: 'rgba(252, 165, 165, 0.12)',
    dotColor: '#fca5a5',
    borderColor: 'rgba(252, 165, 165, 0.15)',
  },
};

const WAKE_WORD_VISUAL: StateVisual = {
  icon: <Ear color="#4af8e3" size={38} strokeWidth={1} />,
  label: 'Active listening',
  sublabel: 'Enhanced',
  gradientColors: ['rgba(74,248,227,0.03)', 'rgba(45,212,191,0.01)', 'transparent'],
  glowColor: 'rgba(74, 248, 227, 0.04)',
  dotColor: '#4af8e3',
  borderColor: 'rgba(74, 248, 227, 0.06)',
};

export type OrbAnimationProfile = 'idle-only' | 'validation' | 'full';

/** States allowed under animationProfile="validation" (isolated route testing). */
export const ORB_VALIDATION_STATES = [
  'idle',
  'passive_listening',
  'speech_detected',
  'processing',
  'recording',
] as const satisfies readonly VoiceCaptureState[];

interface OrbVisualizerProps {
  captureState: VoiceCaptureState;
  captureMode?: CaptureMode | null;
  audioLevel?: SharedValue<number>;
  isWakeWordListening?: boolean;
  /**
   * idle-only   — float + idle transitions
   * validation  — idle | passive_listening | processing (no audio/wake-word)
   * full        — production state machine
   */
  animationProfile?: OrbAnimationProfile;
}

function cancelStateAnimations(values: {
  orbScale: SharedValue<number>;
  glowOpacity: SharedValue<number>;
  glowScale: SharedValue<number>;
  pulseRing1: SharedValue<number>;
  pulseRing2: SharedValue<number>;
  processingRotation: SharedValue<number>;
}) {
  cancelAnimation(values.orbScale);
  cancelAnimation(values.glowOpacity);
  cancelAnimation(values.glowScale);
  cancelAnimation(values.pulseRing1);
  cancelAnimation(values.pulseRing2);
  cancelAnimation(values.processingRotation);
}

function resetPulseAndProcessing(
  pulseRing1: SharedValue<number>,
  pulseRing2: SharedValue<number>,
  processingRotation: SharedValue<number>
) {
  pulseRing1.value = 0;
  pulseRing2.value = 0;
  processingRotation.value = 0;
}

function applyIdleTransition(
  orbScale: SharedValue<number>,
  glowScale: SharedValue<number>,
  glowOpacity: SharedValue<number>
) {
  orbScale.value = withSpring(1, { damping: 25, stiffness: 80 });
  glowScale.value = withSpring(1, { damping: 25, stiffness: 80 });
  glowOpacity.value = withTiming(0.15, { duration: 800 });
}

function applyPassiveListening(
  orbScale: SharedValue<number>,
  glowScale: SharedValue<number>,
  glowOpacity: SharedValue<number>,
  pulseRing1: SharedValue<number>,
  pulseRing2: SharedValue<number>
) {
  orbScale.value = withSpring(1.02, { damping: 25, stiffness: 80 });
  glowOpacity.value = withRepeat(
    withSequence(
      withTiming(0.25, { duration: 3600, easing: Easing.inOut(Easing.ease) }),
      withTiming(0.12, { duration: 3600, easing: Easing.inOut(Easing.ease) })
    ),
    -1,
    true
  );
  glowScale.value = withRepeat(
    withSequence(
      withTiming(1.08, { duration: 3600, easing: Easing.inOut(Easing.ease) }),
      withTiming(1.0, { duration: 3600, easing: Easing.inOut(Easing.ease) })
    ),
    -1,
    true
  );
  pulseRing1.value = 0;
  pulseRing1.value = withRepeat(
    withTiming(1, { duration: 4800, easing: Easing.out(Easing.ease) }),
    -1,
    false
  );
  pulseRing2.value = 0;
  pulseRing2.value = withDelay(
    2400,
    withRepeat(
      withTiming(1, { duration: 4800, easing: Easing.out(Easing.ease) }),
      -1,
      false
    )
  );
}

function applyRecordingBase(glowOpacity: SharedValue<number>) {
  glowOpacity.value = withSpring(0.35, { damping: 25, stiffness: 80 });
}

function applyProcessing(
  orbScale: SharedValue<number>,
  glowOpacity: SharedValue<number>,
  processingRotation: SharedValue<number>
) {
  orbScale.value = withSpring(1, { damping: 25, stiffness: 80 });
  glowOpacity.value = withRepeat(
    withSequence(
      withTiming(0.3, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      withTiming(0.15, { duration: 1200, easing: Easing.inOut(Easing.ease) })
    ),
    -1,
    true
  );
  processingRotation.value = 0;
  processingRotation.value = withRepeat(
    withTiming(360, { duration: 4000, easing: Easing.linear }),
    -1,
    false
  );
}

export function OrbVisualizer({
  captureState,
  captureMode,
  audioLevel,
  isWakeWordListening = false,
  animationProfile = 'full',
}: OrbVisualizerProps) {
  const isIdleOnlyProfile = animationProfile === 'idle-only';
  const isValidationProfile = animationProfile === 'validation';
  const isFullProfile = animationProfile === 'full';
  const hasExternalAudio = audioLevel != null;
  const isRecordingState = captureState === 'recording';
  const allowsAudioReactive =
    isRecordingState &&
    hasExternalAudio &&
    (isFullProfile || isValidationProfile);
  const isInWakeWordMode =
    isFullProfile && isWakeWordListening && (captureState === 'idle' || captureState === 'passive_listening');
  const visual = isInWakeWordMode ? WAKE_WORD_VISUAL : STATE_VISUALS[captureState];

  const defaultAudioLevel = useSharedValue(0);
  const activeAudioLevel = audioLevel ?? defaultAudioLevel;
  const floatY = useSharedValue(0);
  const orbScale = useSharedValue(1);
  const glowScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0.2);
  const processingRotation = useSharedValue(0);
  const pulseRing1 = useSharedValue(0);
  const pulseRing2 = useSharedValue(0);
  const smoothedAudioLevel = useSharedValue(0);
  const audioReactiveEnabled = useSharedValue(0);

  const animationValues = {
    orbScale,
    glowOpacity,
    glowScale,
    pulseRing1,
    pulseRing2,
    processingRotation,
  };

  // ─── Group 1: Persistent background float (idle-safe) ───────────────────
  useEffect(() => {
    floatY.value = withRepeat(
      withSequence(
        withTiming(-6, { duration: 2800, easing: Easing.inOut(Easing.ease) }),
        withTiming(6, { duration: 2800, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
    return () => {
      cancelAnimation(floatY);
    };
  }, [floatY]);

  // ─── Group 2: Idle-only state transitions (no repeats, no pulse rings) ──
  useEffect(() => {
    if (!isIdleOnlyProfile) return;

    cancelStateAnimations(animationValues);
    resetPulseAndProcessing(pulseRing1, pulseRing2, processingRotation);
    applyIdleTransition(orbScale, glowScale, glowOpacity);

    return () => {
      cancelStateAnimations(animationValues);
    };
  }, [isIdleOnlyProfile, orbScale, glowScale, glowOpacity, pulseRing1, pulseRing2, processingRotation]);

  // ─── Groups 3–5: Validation + full state machine ────────────────────────
  useEffect(() => {
    if (isIdleOnlyProfile) return;

    cancelStateAnimations(animationValues);

    if (isValidationProfile) {
      resetPulseAndProcessing(pulseRing1, pulseRing2, processingRotation);
      switch (captureState) {
        case 'idle':
          applyIdleTransition(orbScale, glowScale, glowOpacity);
          break;
        case 'passive_listening':
          applyPassiveListening(
            orbScale,
            glowScale,
            glowOpacity,
            pulseRing1,
            pulseRing2
          );
          break;
        case 'speech_detected':
          orbScale.value = withSpring(1.05, { damping: 25, stiffness: 80 });
          glowOpacity.value = withSpring(0.3, { damping: 25, stiffness: 80 });
          glowScale.value = withSpring(1.1, { damping: 25, stiffness: 80 });
          break;
        case 'processing':
          applyProcessing(orbScale, glowOpacity, processingRotation);
          break;
        case 'recording':
          resetPulseAndProcessing(pulseRing1, pulseRing2, processingRotation);
          applyRecordingBase(glowOpacity);
          break;
        default:
          applyIdleTransition(orbScale, glowScale, glowOpacity);
          break;
      }
      return () => {
        cancelStateAnimations(animationValues);
      };
    }

    if (isInWakeWordMode) {
      orbScale.value = withSpring(1.01, { damping: 25, stiffness: 80 });
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.2, { duration: 4800, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.08, { duration: 4800, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
      glowScale.value = withRepeat(
        withSequence(
          withTiming(1.06, { duration: 4800, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.0, { duration: 4800, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
      pulseRing1.value = 0;
      pulseRing1.value = withRepeat(
        withTiming(1, { duration: 6400, easing: Easing.out(Easing.ease) }),
        -1,
        false
      );
      pulseRing2.value = 0;
      pulseRing2.value = withDelay(
        3200,
        withRepeat(
          withTiming(1, { duration: 6400, easing: Easing.out(Easing.ease) }),
          -1,
          false
        )
      );
    } else {
      resetPulseAndProcessing(pulseRing1, pulseRing2, processingRotation);

      switch (captureState) {
        case 'idle':
          applyIdleTransition(orbScale, glowScale, glowOpacity);
          break;

        case 'passive_listening':
          applyPassiveListening(
            orbScale,
            glowScale,
            glowOpacity,
            pulseRing1,
            pulseRing2
          );
          break;

        case 'speech_detected':
          orbScale.value = withSpring(1.06, { damping: 25, stiffness: 80 });
          glowOpacity.value = withSpring(0.35, { damping: 25, stiffness: 80 });
          glowScale.value = withSpring(1.15, { damping: 25, stiffness: 80 });
          break;

        case 'recording':
          applyRecordingBase(glowOpacity);
          break;

        case 'processing':
          applyProcessing(orbScale, glowOpacity, processingRotation);
          break;

        case 'saved':
          orbScale.value = withSequence(
            withSpring(1.12, { damping: 25, stiffness: 80 }),
            withSpring(1, { damping: 25, stiffness: 80 })
          );
          glowOpacity.value = withSequence(
            withTiming(0.5, { duration: 600 }),
            withTiming(0.2, { duration: 3000 })
          );
          break;

        case 'error':
          orbScale.value = withSequence(
            withTiming(0.95, { duration: 200 }),
            withSpring(1, { damping: 25, stiffness: 80 })
          );
          glowOpacity.value = withRepeat(
            withSequence(
              withTiming(0.3, { duration: 800 }),
              withTiming(0.1, { duration: 800 })
            ),
            3,
            true
          );
          break;

        case 'consent_required':
          applyIdleTransition(orbScale, glowScale, glowOpacity);
          break;
      }
    }

    return () => {
      cancelStateAnimations(animationValues);
    };
  }, [isIdleOnlyProfile, isValidationProfile, isFullProfile, captureState, isInWakeWordMode]);

  useEffect(() => {
    audioReactiveEnabled.value = allowsAudioReactive ? 1 : 0;
    if (!allowsAudioReactive) {
      smoothedAudioLevel.value = 0;
    }
  }, [allowsAudioReactive, audioReactiveEnabled, smoothedAudioLevel]);

  useAnimatedReaction(
    () => activeAudioLevel.value,
    (level) => {
      'worklet';
      if (audioReactiveEnabled.value === 0) return;
      const current = smoothedAudioLevel.value;
      const delta = level - current;
      if (Math.abs(delta) < 0.001) {
        smoothedAudioLevel.value = level;
        return;
      }
      smoothedAudioLevel.value = current + delta * AUDIO_LEVEL_SMOOTH_ALPHA;
    },
    [activeAudioLevel, audioReactiveEnabled, smoothedAudioLevel]
  );

  const animatedFloat = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }],
  }));

  const animatedOrb = useAnimatedStyle(() => {
    let scale = orbScale.value;
    if (audioReactiveEnabled.value === 1) {
      const level = smoothedAudioLevel.value;
      scale = 1 + Math.min(level * 0.25, 0.25);
    }
    return { transform: [{ scale }] };
  });

  const animatedGlow = useAnimatedStyle(() => {
    let opacity = glowOpacity.value;
    let scale = glowScale.value;
    if (audioReactiveEnabled.value === 1) {
      const level = smoothedAudioLevel.value;
      opacity = 0.35 + level * 0.35;
      scale = 1 + level * 0.3;
    }
    return {
      transform: [{ scale }],
      opacity,
    };
  });

  const animatedProcessingIcon = useAnimatedStyle(() => ({
    transform: [{ rotate: `${processingRotation.value}deg` }],
  }));

  const animatedPulseRing1 = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(pulseRing1.value, [0, 1], [1, 1.8], Extrapolation.CLAMP) },
    ],
    opacity: interpolate(pulseRing1.value, [0, 0.3, 1], [0.15, 0.1, 0], Extrapolation.CLAMP),
  }));

  const animatedPulseRing2 = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(pulseRing2.value, [0, 1], [1, 1.8], Extrapolation.CLAMP) },
    ],
    opacity: interpolate(pulseRing2.value, [0, 0.3, 1], [0.15, 0.1, 0], Extrapolation.CLAMP),
  }));

  const showPulseRings =
    !isIdleOnlyProfile &&
    (captureState === 'passive_listening' || (isFullProfile && isInWakeWordMode));
  const isProcessing =
    !isIdleOnlyProfile && captureState === 'processing';

  return (
    <Animated.View
      style={[styles.wrapper, animatedFloat]}
      pointerEvents="box-none"
      collapsable={false}
    >
      {!!showPulseRings && (
        <>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pulseRing,
              { backgroundColor: visual.glowColor },
              animatedPulseRing1,
            ]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pulseRing,
              { backgroundColor: visual.glowColor },
              animatedPulseRing2,
            ]}
          />
        </>
      )}

      <Animated.View
        pointerEvents="none"
        style={[
          styles.glowRing,
          animatedGlow,
          {
            backgroundColor: visual.glowColor,
            shadowColor: visual.dotColor,
          },
        ]}
      />

      <Animated.View pointerEvents="none" style={[styles.orbOuter, animatedOrb]}>
        <View
          pointerEvents="none"
          style={[styles.orb, { borderColor: visual.borderColor }]}
        >
          <LinearGradient
            pointerEvents="none"
            colors={visual.gradientColors as [string, string, string]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          <View pointerEvents="none" style={styles.orbContent}>
            <View style={styles.iconWrap}>
              {isProcessing ? (
                <Animated.View pointerEvents="none" style={animatedProcessingIcon}>
                  {visual.icon}
                </Animated.View>
              ) : captureMode === 'meeting' &&
                (captureState === 'recording' || captureState === 'idle') ? (
                <Users
                  color={
                    visual.dotColor === '#444'
                      ? 'rgba(252, 248, 254, 0.5)'
                      : visual.dotColor
                  }
                  size={42}
                  strokeWidth={1.5}
                />
              ) : (
                visual.icon
              )}
            </View>

            <Text
              style={[
                styles.statusText,
                captureState !== 'idle' && styles.statusActive,
              ]}
            >
              {visual.label}
            </Text>

            <View style={styles.dotRow}>
              <View style={[styles.dot, { backgroundColor: visual.dotColor }]} />
              <Text style={styles.dotLabel}>{visual.sublabel}</Text>
            </View>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 300,
    height: 300,
    overflow: 'hidden',
  },
  pulseRing: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    top: 20,
    left: 20,
  },
  glowRing: {
    position: 'absolute',
    width: 290,
    height: 290,
    borderRadius: 145,
    top: 5,
    left: 5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 30,
    elevation: 8,
  },
  orbOuter: {
    width: 260,
    height: 260,
  },
  orb: {
    flex: 1,
    borderRadius: 130,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.005)',
    shadowColor: '#c799ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.02,
    shadowRadius: 20,
    elevation: 2,
  },
  orbContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    marginBottom: 8,
  },
  statusText: {
    fontSize: 18,
    fontWeight: '600',
    color: 'rgba(252, 248, 254, 0.65)',
    letterSpacing: -0.2,
  },
  statusActive: {
    color: '#fcf8fe',
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotLabel: {
    fontSize: 10,
    color: '#777',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
});
