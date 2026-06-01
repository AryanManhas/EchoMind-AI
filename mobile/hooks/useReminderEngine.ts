import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import type { ConversationMemory } from './usePersistentMemory';
import { generateProactiveNudges } from '../lib/proactiveNudges';

const REMINDER_STORAGE_KEY = '@EchoMind:Reminders';
const REMINDER_BACKUP_KEY = '@EchoMind:Reminders:Backup';
const REMINDER_CORRUPT_KEY = '@EchoMind:Reminders:Corrupt';
const REMINDER_CHANNEL_ID = 'reminders';
const MAX_RESTORED_TASKS = 240;
const LOCAL_TRIGGER_POLL_MS = 30_000;

export type ReminderState = 'pending' | 'scheduled' | 'triggered' | 'completed' | 'dismissed' | 'expired';

export type ReminderTask = {
  id: string;
  sourceSessionId: string;
  semanticObjectId?: string;
  type: 'reminder' | 'meeting' | 'follow_up' | 'calendar_event';
  title: string;
  description?: string;
  scheduledFor?: number;
  createdAt: number;
  updatedAt: number;
  state: ReminderState;
  confidence: number;
  metadata: {
    participants?: string[];
    extractedDatetime?: string;
    localeHints?: string[];
  };
};

export type UseReminderEngineReturn = {
  tasks: ReminderTask[];
  isLoaded: boolean;
  diagnostics: {
    restoredCount: number;
    prunedCount: number;
    recoveredFromBackup: boolean;
    corruptedStoreRecovered: boolean;
    scheduledNotificationCount: number;
    lastNotificationRestoreAt: number | null;
  };
  generateTasksFromMemory: (memory: ConversationMemory) => Promise<string[]>;
  completeTask: (taskId: string) => Promise<void>;
  dismissTask: (taskId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  clearTasks: () => Promise<void>;
  reloadTasks: () => Promise<void>;
};

function notificationIdForTask(taskId: string): string {
  return `reminder:${taskId}`;
}

function parseScheduledFor(datetime?: string): number | undefined {
  if (!datetime) return undefined;
  const scheduledFor = Date.parse(datetime);
  if (!Number.isFinite(scheduledFor)) return undefined;
  return scheduledFor;
}

function isPromotableSemanticObject(so: ConversationMemory['semanticObjects'][number]): boolean {
  if (!so.task || so.task.trim().length < 3) return false;
  const hasFutureSchedule = !!parseScheduledFor(so.datetime);

  if (so.type === 'reminder') {
    return so.confidence >= 0.9 && (hasFutureSchedule || so.confidence >= 0.95);
  }

  if (so.type === 'meeting_action') {
    return so.confidence >= 0.85 && (hasFutureSchedule || (so.participants?.length || 0) > 0);
  }

  if (so.type === 'follow_up') {
    return so.confidence >= 0.86 && (hasFutureSchedule || so.confidence >= 0.92);
  }

  if (so.type === 'calendar_event') {
    return so.confidence >= 0.9 && hasFutureSchedule;
  }

  return false;
}

async function ensureReminderChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#4AF8E3',
  });
}

async function cancelTaskNotification(taskId: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationIdForTask(taskId));
    // Also cancel up to 3 nudges
    for (let i = 0; i < 3; i++) {
      await Notifications.cancelScheduledNotificationAsync(`${taskId}-nudge-${i}`);
    }
  } catch (e) {
    if (__DEV__) console.warn('[ReminderEngine] Failed to cancel notification', e);
  }
}

async function scheduleTaskNotification(task: ReminderTask): Promise<void> {
  if (task.state !== 'scheduled' || !task.scheduledFor || task.scheduledFor <= Date.now()) {
    await cancelTaskNotification(task.id);
    return;
  }

  try {
    await ensureReminderChannel();
    await cancelTaskNotification(task.id);
    
    const nudges = generateProactiveNudges(task);
    
    // Schedule proactive nudges
    for (const nudge of nudges) {
      await Notifications.scheduleNotificationAsync({
        identifier: nudge.id,
        content: {
          title: nudge.title,
          body: nudge.body,
          data: {
            taskId: task.id,
            sourceSessionId: task.sourceSessionId,
            semanticObjectId: task.semanticObjectId,
            isProactiveNudge: true,
          },
          categoryIdentifier: 'reminder_actions',
        },
        trigger: {
          date: new Date(nudge.triggerAt),
          channelId: REMINDER_CHANNEL_ID,
        } as any,
      } as any);
    }

    // Schedule the exact final alarm as a fallback, unless we generated 3 nudges already
    if (nudges.length === 0) {
      await Notifications.scheduleNotificationAsync({
        identifier: notificationIdForTask(task.id),
        content: {
          title: task.title,
          body: task.description || 'Reminder from EchoMind',
          data: {
            taskId: task.id,
            sourceSessionId: task.sourceSessionId,
            semanticObjectId: task.semanticObjectId,
          },
          categoryIdentifier: 'reminder_actions',
        },
        trigger: {
          date: new Date(task.scheduledFor),
          channelId: REMINDER_CHANNEL_ID,
        } as any,
      } as any);
    }
  } catch (e) {
    if (__DEV__) console.warn('[ReminderEngine] Failed to schedule notification', e);
  }
}

function normalizeString(str: string): string {
  return str.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim();
}

function calculateSimilarity(str1: string, str2: string): number {
  const s1 = normalizeString(str1);
  const s2 = normalizeString(str2);
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  return 0.0;
}

function dedupeTasks(tasks: ReminderTask[]): ReminderTask[] {
  const byId = new Map<string, ReminderTask>();
  for (const task of tasks) {
    const existing = byId.get(task.id);
    if (!existing || task.updatedAt >= existing.updatedAt) {
      byId.set(task.id, task);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => {
      const aActive = a.state === 'pending' || a.state === 'scheduled' || a.state === 'triggered';
      const bActive = b.state === 'pending' || b.state === 'scheduled' || b.state === 'triggered';
      if (aActive !== bActive) return aActive ? -1 : 1;
      return b.createdAt - a.createdAt;
    })
    .slice(0, MAX_RESTORED_TASKS);
}

async function persistTasks(tasks: ReminderTask[]): Promise<void> {
  const payload = JSON.stringify(dedupeTasks(tasks));
  await AsyncStorage.setItem(REMINDER_BACKUP_KEY, payload);
  await AsyncStorage.setItem(REMINDER_STORAGE_KEY, payload);
}

async function readTaskArray(key: string): Promise<ReminderTask[] | null> {
  const data = await AsyncStorage.getItem(key);
  if (!data) return [];
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function restoreScheduledNotifications(tasks: ReminderTask[]): Promise<number> {
  const scheduled = tasks.filter(task => task.state === 'scheduled' && task.scheduledFor && task.scheduledFor > Date.now());
  for (const task of scheduled) {
    await scheduleTaskNotification(task);
  }
  return scheduled.length;
}

export function useReminderEngine(memories?: ConversationMemory[]): UseReminderEngineReturn {
  const [tasks, setTasks] = useState<ReminderTask[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [diagnostics, setDiagnostics] = useState<UseReminderEngineReturn['diagnostics']>({
    restoredCount: 0,
    prunedCount: 0,
    recoveredFromBackup: false,
    corruptedStoreRecovered: false,
    scheduledNotificationCount: 0,
    lastNotificationRestoreAt: null,
  });

  // Guard against duplicate task creation for the same memory ID
  const processedMemorySemanticCountRef = useRef<Map<string, number>>(new Map());

  // Automatically generate tasks for any new memories if memories are passed
  useEffect(() => {
    if (!isLoaded || !memories) return;

    const validSessionIds = new Set(memories.map(m => m.sessionId));
    setTasks(prev => {
      let hasDeletions = false;
      const remaining = prev.filter(t => {
        if (!validSessionIds.has(t.sourceSessionId)) {
          hasDeletions = true;
          void cancelTaskNotification(t.id);
          return false;
        }
        return true;
      });

      if (hasDeletions) {
        persistTasks(remaining).catch(e => {
          if (__DEV__) console.warn('[ReminderEngine] Failed to save task deletions', e);
        });
        return remaining;
      }
      return prev;
    });

    if (memories.length === 0) return;

    memories.forEach(mem => {
      const prevCount = processedMemorySemanticCountRef.current.get(mem.sessionId);
      const currentCount = mem.semanticObjects?.length || 0;
      if (prevCount === currentCount) return;

      void generateTasksFromMemory(mem).then((taskIds) => {
        if (taskIds.length === 0) return;
      });
    });
  }, [memories, isLoaded]);

  const loadTasks = useCallback(async () => {
    try {
      let recoveredFromBackup = false;
      let corruptedStoreRecovered = false;
      let parsed = await readTaskArray(REMINDER_STORAGE_KEY);

      if (parsed === null) {
        corruptedStoreRecovered = true;
        const raw = await AsyncStorage.getItem(REMINDER_STORAGE_KEY);
        if (raw) await AsyncStorage.setItem(REMINDER_CORRUPT_KEY, raw.slice(0, 24000));
        parsed = await readTaskArray(REMINDER_BACKUP_KEY);
        recoveredFromBackup = Array.isArray(parsed);
      }

      if (parsed && parsed.length >= 0) {
        // Sanity check overdue tasks upon load
        const now = Date.now();
        const checkedTasks = dedupeTasks(parsed).map(t => {
          if (t.state === 'scheduled' && t.scheduledFor && t.scheduledFor <= now) {
            return { ...t, state: 'triggered' as ReminderState, updatedAt: now };
          }
          return t;
        });

        setTasks(prev => {
          const merged = dedupeTasks([...prev, ...checkedTasks]);
          
          // Populate processed memories based on all merged tasks
          merged.forEach(t => {
            if (!processedMemorySemanticCountRef.current.has(t.sourceSessionId)) {
              processedMemorySemanticCountRef.current.set(t.sourceSessionId, 1);
            }
          });
          
          if (JSON.stringify(prev) !== JSON.stringify(merged)) {
            persistTasks(merged).catch(e => {
              if (__DEV__) console.warn('[ReminderEngine] Failed to save load-time merged tasks', e);
            });
          }
          return merged;
        });
        const scheduledNotificationCount = await restoreScheduledNotifications(checkedTasks);
        setDiagnostics({
          restoredCount: checkedTasks.length,
          prunedCount: Math.max(0, parsed.length - checkedTasks.length),
          recoveredFromBackup,
          corruptedStoreRecovered,
          scheduledNotificationCount,
          lastNotificationRestoreAt: Date.now(),
        });
        if (!(global as any).isPresentationMode) {
          console.log('[DEV] hydration completed. Loaded reminders count:', checkedTasks.length);
        }
        

      }
    } catch (e) {
      setDiagnostics(prev => ({
        ...prev,
        corruptedStoreRecovered: true,
        lastNotificationRestoreAt: Date.now(),
      }));
      if (__DEV__) {
        console.warn('[ReminderEngine] Failed to load tasks', e);
      }
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadTasks();

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        void loadTasks();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [loadTasks]);

  // Periodic deterministic local trigger loop
  useEffect(() => {
    if (!isLoaded) return;
    
    const interval = setInterval(() => {
      const now = Date.now();
      setTasks(prev => {
        let hasChanges = false;
        const updated = prev.map(task => {
          if (task.state === 'scheduled' && task.scheduledFor && task.scheduledFor <= now) {
            hasChanges = true;
            return { ...task, state: 'triggered' as ReminderState, updatedAt: now };
          }
          return task;
        });
        
        if (hasChanges) {
          // Fire-and-forget persist
          persistTasks(updated).catch(e => {
            if (__DEV__) console.warn('[ReminderEngine] Failed to save triggered tasks', e);
          });
          updated.forEach(task => {
            if (task.state === 'triggered') void cancelTaskNotification(task.id);
          });
          return updated;
        }
        return prev;
      });
    }, LOCAL_TRIGGER_POLL_MS);

    return () => clearInterval(interval);
  }, [isLoaded]);

  const generateTasksFromMemory = useCallback(async (memory: ConversationMemory): Promise<string[]> => {
    const currentCount = memory.semanticObjects?.length || 0;
    processedMemorySemanticCountRef.current.set(memory.sessionId, currentCount);
    
    const validObjects = (memory.semanticObjects || []).filter(isPromotableSemanticObject);
    if (validObjects.length === 0) {
      return [];
    }

    const now = Date.now();
    const newTasks: ReminderTask[] = validObjects.map((so, index) => {
      const scheduledFor = parseScheduledFor(so.datetime);
      
      const typeMap: Record<string, 'reminder'|'meeting'|'follow_up'|'calendar_event'> = {
        'reminder': 'reminder',
        'meeting_action': 'meeting',
        'follow_up': 'follow_up',
        'calendar_event': 'calendar_event',
      };
      
      const task: ReminderTask = {
        id: `task-${memory.sessionId}-${index}`,
        sourceSessionId: memory.sessionId,
        semanticObjectId: so.task || memory.id,
        type: typeMap[so.type] || 'reminder',
        title: so.task || 'Untitled Task',
        description: so.participants?.length 
          ? `Assigned to: ${so.participants.join(', ')}` 
          : 'Reminder from EchoMind',
        scheduledFor,
        createdAt: now,
        updatedAt: now,
        state: scheduledFor ? (scheduledFor <= now ? 'triggered' : 'scheduled') : 'pending',
        confidence: so.confidence,
        metadata: {
          participants: so.participants,
          extractedDatetime: so.datetime,
          localeHints: memory.localeHints || memory.metadata?.localeHints || [],
        }
      };

      if (!(global as any).isPresentationMode) {
        console.log('[DEV] reminder generated:', task.id);
      }

      return task;
    });

    setTasks(prev => {
      const existingIds = new Set(prev.map(task => task.id));
      const uniqueNewTasks = newTasks.filter(task => {
        if (existingIds.has(task.id)) return false;
        // Semantic deduplication
        for (const existingTask of prev) {
          if (calculateSimilarity(task.title, existingTask.title) > 0.75) {
             return false;
          }
        }
        return true;
      });
      const updated = dedupeTasks([...uniqueNewTasks, ...prev]);
      persistTasks(updated).catch(e => {
        if (__DEV__) console.warn('[ReminderEngine] Failed to save new tasks', e);
      });
      uniqueNewTasks.forEach(task => {
        void scheduleTaskNotification(task);
      });
      return updated;
    });

    return newTasks.map(t => t.id);
  }, []);

  const updateTaskState = useCallback(async (taskId: string, newState: ReminderState) => {
    setTasks(prev => {
      const updated = prev.map(t => 
        t.id === taskId ? { ...t, state: newState, updatedAt: Date.now() } : t
      );
      persistTasks(updated).catch(e => {
        if (__DEV__) console.warn('[ReminderEngine] Failed to update task state', e);
      });
      void cancelTaskNotification(taskId);
      return updated;
    });
  }, []);

  const completeTask = useCallback((taskId: string) => updateTaskState(taskId, 'completed'), [updateTaskState]);
  const dismissTask = useCallback((taskId: string) => updateTaskState(taskId, 'dismissed'), [updateTaskState]);

  const deleteTask = useCallback(async (taskId: string) => {
    setTasks(prev => {
      const updated = prev.filter(task => task.id !== taskId);
      persistTasks(updated).catch(e => {
        if (__DEV__) console.warn('[ReminderEngine] Failed to delete task', e);
      });
      void cancelTaskNotification(taskId);
      return updated;
    });
  }, []);

  const clearTasks = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(REMINDER_STORAGE_KEY);
      await AsyncStorage.removeItem(REMINDER_BACKUP_KEY);
      await Promise.all(tasks.map(task => cancelTaskNotification(task.id)));
      setTasks([]);
      processedMemorySemanticCountRef.current.clear();
    } catch (e) {
      if (__DEV__) {
        console.warn('[ReminderEngine] Failed to clear tasks', e);
      }
    }
  }, [tasks]);

  return {
    tasks,
    isLoaded,
    diagnostics,
    generateTasksFromMemory,
    completeTask,
    dismissTask,
    deleteTask,
    clearTasks,
    reloadTasks: loadTasks,
  };
}
