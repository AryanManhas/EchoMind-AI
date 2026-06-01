import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeConversationVaultEntry, ConversationMemory } from './usePersistentMemory';
import { ReminderTask } from './useReminderEngine';

const PRESENTATION_MODE_KEY = '@EchoMind:IsPresentationMode';
const MEMORY_STORAGE_KEY = '@EchoMind:ConversationMemory';
const REMINDER_STORAGE_KEY = '@EchoMind:Reminders';

const BACKUP_MEMORY_KEY = '@EchoMind:OriginalMemory';
const BACKUP_REMINDER_KEY = '@EchoMind:OriginalReminders';

// Shared global state and listeners for instant tab/screen updates
let globalIsPresentationMode = false;
const listeners = new Set<(val: boolean) => void>();

// Hydrate from storage on start
AsyncStorage.getItem(PRESENTATION_MODE_KEY).then(val => {
  if (val !== null) {
    globalIsPresentationMode = val === 'true';
    (global as any).isPresentationMode = globalIsPresentationMode;
    listeners.forEach(l => l(globalIsPresentationMode));
  }
});

export function usePresentationMode() {
  const [isPresentationMode, setIsPresentationMode] = useState(globalIsPresentationMode);

  useEffect(() => {
    const handleUpdate = (val: boolean) => setIsPresentationMode(val);
    listeners.add(handleUpdate);
    return () => {
      listeners.delete(handleUpdate);
    };
  }, []);

  const togglePresentationMode = useCallback(() => {
    const next = !globalIsPresentationMode;
    globalIsPresentationMode = next;
    (global as any).isPresentationMode = next;
    AsyncStorage.setItem(PRESENTATION_MODE_KEY, String(next));
    listeners.forEach(l => l(next));
    if (__DEV__) console.log(`[Presentation Mode] ${next ? 'ENABLED' : 'DISABLED'}`);
  }, []);

  const seedDemoData = useCallback(async (onReloadMemory?: () => void, onReloadTasks?: () => void) => {
    const isActivating = globalIsPresentationMode;
    
    if (isActivating) {
      if (__DEV__) console.log('[Presentation Mode] Seeding demo data...');

      // 1. Backup existing real data if not backed up already
      const currentMemory = await AsyncStorage.getItem(MEMORY_STORAGE_KEY);
      const currentReminders = await AsyncStorage.getItem(REMINDER_STORAGE_KEY);

      const existingBackupMemory = await AsyncStorage.getItem(BACKUP_MEMORY_KEY);
      if (!existingBackupMemory) {
        await AsyncStorage.setItem(BACKUP_MEMORY_KEY, currentMemory || '[]');
      }
      
      const existingBackupReminders = await AsyncStorage.getItem(BACKUP_REMINDER_KEY);
      if (!existingBackupReminders) {
        await AsyncStorage.setItem(BACKUP_REMINDER_KEY, currentReminders || '[]');
      }

      // 2. Generate polished demo data with current relative times
      const now = Date.now();
      
      const demoMemoryRaw = [
        {
          sessionId: 'demo-session-1',
          createdAt: now - 3600000 * 2, // 2 hours ago
          finalizedAt: now - 3600000 * 2 + 120000,
          sessionType: 'general',
          sessionTitle: 'AI Presentation Planning',
          mergedTranscript: 'We need to prepare the presentation slides for the EchoMind AI demo tomorrow. Make sure all developer diagnostics are hidden and the Orb Visualizer animation flows smoothly with natural easing.',
          semanticSummary: 'Discussed EchoMind AI presentation plan, emphasizing the removal of dev diagnostic panels and finalizing smooth orb visualizer physics.',
          extractedTasks: ['Finalize presentation slides', 'Verify developer panel hiding configuration'],
          reminders: ['AI presentation tomorrow'],
          participants: ['Aryan'],
          turns: [
            { role: 'user', text: 'Hey EchoMind, let\'s write down our task list for the AI presentation tomorrow. We need to hide all diagnostic panels.', timestamp: now - 3600000 * 2 },
            { role: 'assistant', text: 'Got it. I have noted that down. We\'ll make sure Presentation Mode hides all developer overlays and is ready for demonstration.', timestamp: now - 3600000 * 2 + 30000 }
          ]
        },
        {
          sessionId: 'demo-session-2',
          createdAt: now - 3600000 * 6, // 6 hours ago
          finalizedAt: now - 3600000 * 6 + 180000,
          sessionType: 'meeting',
          sessionTitle: 'Rahul Sync',
          mergedTranscript: 'Aryan will sync up with Rahul at 4 PM to coordinate on placement preparation and finalize the frontend planning checklists.',
          semanticSummary: 'Meeting scheduled with Rahul at 4 PM to align on placement preparation strategies and review system design questions.',
          extractedTasks: ['Align on placement test cases', 'Practice system design questions'],
          reminders: ['Meet Rahul at 4 PM'],
          participants: ['Aryan', 'Rahul'],
          turns: [
            { role: 'user', text: 'Aryan and Rahul are meeting at 4 PM to go over placement prep.', timestamp: now - 3600000 * 6 },
            { role: 'assistant', text: 'I\'ve noted the meeting with Rahul at 4 PM. I\'ll remind you to prepare.', timestamp: now - 3600000 * 6 + 45000 }
          ]
        },
        {
          sessionId: 'demo-session-3',
          createdAt: now - 3600000 * 24, // 1 day ago
          finalizedAt: now - 3600000 * 24 + 300000,
          sessionType: 'brainstorming',
          sessionTitle: 'Frontend Team Discussion',
          mergedTranscript: 'Let\'s review the frontend UI design, particularly the clean ambient visual feedback and the participant tracking in meeting mode. We must ensure no websocket errors or raw stack traces are exposed.',
          semanticSummary: 'Frontend planning brainstorm focused on ambient visual cues, stable real-time speech amplitude, and ensuring runtime guardian suppresses error overlays.',
          extractedTasks: ['Improve Orb animation smoothness', 'Implement local meeting mode participant extractor'],
          reminders: [],
          participants: ['Aryan', 'Developer'],
          turns: [
            { role: 'user', text: 'We need to design a premium UI. The orb animation should feel calm and ambient, react smoothly to speech levels, and suppress error details.', timestamp: now - 3600000 * 24 },
            { role: 'assistant', text: 'We can achieve that by reducing jitter in the amplitude mapping and mapping websocket errors to friendly local messages.', timestamp: now - 3600000 * 24 + 60000 }
          ]
        },
        {
          sessionId: 'demo-session-4',
          createdAt: now - 3600000 * 48, // 2 days ago
          finalizedAt: now - 3600000 * 48 + 240000,
          sessionType: 'follow_up',
          sessionTitle: 'Placement Preparation',
          mergedTranscript: 'We went through the resume review and mock interview questions. The next step is practicing algorithm questions and system design scenarios.',
          semanticSummary: 'Follow-up regarding placement preparation, setting action items to solve algorithmic challenges and study distributed system designs.',
          extractedTasks: ['Solve 5 LeetCode problems', 'Study distributed systems database patterns'],
          reminders: [],
          participants: ['Aryan'],
          turns: [
            { role: 'user', text: 'Let\'s track my progress on mock interviews and system design preparation.', timestamp: now - 3600000 * 48 },
            { role: 'assistant', text: 'Sure. I\'ll keep track of your LeetCode goals and system design review checklist.', timestamp: now - 3600000 * 48 + 40000 }
          ]
        }
      ];

      const demoMemories = demoMemoryRaw.map(normalizeConversationVaultEntry);

      const demoTasks: ReminderTask[] = [
        {
          id: 'demo-task-1',
          sourceSessionId: 'demo-session-1',
          type: 'reminder',
          title: 'AI presentation tomorrow',
          description: 'Prepare slides and verify developer diagnostic panels are hidden.',
          scheduledFor: now + 24 * 60 * 60 * 1000, // 24 hours from now
          createdAt: now - 3600000 * 2,
          updatedAt: now,
          state: 'scheduled',
          confidence: 0.95,
          metadata: { participants: ['Aryan'] }
        },
        {
          id: 'demo-task-2',
          sourceSessionId: 'demo-session-2',
          type: 'meeting',
          title: 'Meet Rahul at 4 PM',
          description: 'Discuss placement preparation strategy and system design topics.',
          scheduledFor: now + 4 * 60 * 60 * 1000, // 4 hours from now
          createdAt: now - 3600000 * 6,
          updatedAt: now,
          state: 'scheduled',
          confidence: 0.92,
          metadata: { participants: ['Aryan', 'Rahul'] }
        },
        {
          id: 'demo-task-3',
          sourceSessionId: 'demo-session-3',
          type: 'follow_up',
          title: 'Frontend planning discussion',
          description: 'Polish orb micro-interactions and test presentation view reliability.',
          createdAt: now - 3600000 * 24,
          updatedAt: now,
          state: 'pending',
          confidence: 0.88,
          metadata: { participants: ['Aryan', 'Developer'] }
        },
        {
          id: 'demo-task-4',
          sourceSessionId: 'demo-session-4',
          type: 'follow_up',
          title: 'Placement preparation',
          description: 'Solve system design exercises and practice interview questions.',
          createdAt: now - 3600000 * 48,
          updatedAt: now,
          state: 'pending',
          confidence: 0.90,
          metadata: { participants: ['Aryan'] }
        },
        {
          id: 'demo-task-5',
          sourceSessionId: 'demo-session-2',
          type: 'follow_up',
          title: 'Meeting follow-up tasks',
          description: 'Execute action items from the sync meeting with Rahul.',
          createdAt: now - 3600000 * 5,
          updatedAt: now,
          state: 'pending',
          confidence: 0.85,
          metadata: { participants: ['Aryan', 'Rahul'] }
        }
      ];

      await AsyncStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(demoMemories));
      await AsyncStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(demoTasks));
    } else {
      if (__DEV__) console.log('[Presentation Mode] Restoring original data...');

      // 3. Restore backed up real data
      const backupMemory = await AsyncStorage.getItem(BACKUP_MEMORY_KEY);
      const backupReminders = await AsyncStorage.getItem(BACKUP_REMINDER_KEY);

      if (backupMemory) {
        await AsyncStorage.setItem(MEMORY_STORAGE_KEY, backupMemory);
      } else {
        await AsyncStorage.removeItem(MEMORY_STORAGE_KEY);
      }

      if (backupReminders) {
        await AsyncStorage.setItem(REMINDER_STORAGE_KEY, backupReminders);
      } else {
        await AsyncStorage.removeItem(REMINDER_STORAGE_KEY);
      }

      await AsyncStorage.removeItem(BACKUP_MEMORY_KEY);
      await AsyncStorage.removeItem(BACKUP_REMINDER_KEY);
    }

    // 4. Trigger UI reload callbacks
    if (onReloadMemory) await onReloadMemory();
    if (onReloadTasks) await onReloadTasks();
  }, []);

  return {
    isPresentationMode,
    togglePresentationMode,
    seedDemoData,
  };
}

