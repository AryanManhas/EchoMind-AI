import { useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConversationVaultEntry } from './usePersistentMemory';
import type { ReminderTask } from './useReminderEngine';

export interface BriefingData {
  greeting: string;
  meetings: { title: string; participants?: string[] }[];
  reminders: ReminderTask[];
  unresolvedTasks: string[];
  semanticPriorities: string[];
  isActive: boolean;
  generatedAt: number | null;
}

const BRIEFING_TIMESTAMP_KEY = '@EchoMind:Briefing:LastTimestamp';
const BRIEFING_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours

export function useDailyBriefing(memories: ConversationVaultEntry[], tasks: ReminderTask[]) {
  const [briefing, setBriefing] = useState<BriefingData>({
    greeting: '',
    meetings: [],
    reminders: [],
    unresolvedTasks: [],
    semanticPriorities: [],
    isActive: false,
    generatedAt: null,
  });
  
  const [isLoaded, setIsLoaded] = useState(false);

  const generateGreeting = (
    meetingsCount: number,
    tasksCount: number,
    remindersCount: number
  ) => {
    const hour = new Date().getHours();
    let timeOfDay = 'Good evening';
    if (hour < 12) timeOfDay = 'Good morning';
    else if (hour < 17) timeOfDay = 'Good afternoon';

    const components = [];
    if (meetingsCount > 0) components.push(`${meetingsCount} meeting${meetingsCount > 1 ? 's' : ''}`);
    if (tasksCount > 0) components.push(`${tasksCount} pending task${tasksCount > 1 ? 's' : ''}`);
    if (remindersCount > 0) components.push(`${remindersCount} active reminder${remindersCount > 1 ? 's' : ''}`);

    if (components.length === 0) {
      return `${timeOfDay}. Your schedule is clear.`;
    }

    if (components.length === 1) {
      return `${timeOfDay}. You have ${components[0]} today.`;
    }

    const last = components.pop();
    return `${timeOfDay}. You have ${components.join(', ')} and ${last} today.`;
  };

  const generateBriefing = useCallback(async (force = false) => {
    const now = Date.now();
    
    if (!force) {
      try {
        const lastTimestampStr = await AsyncStorage.getItem(BRIEFING_TIMESTAMP_KEY);
        if (lastTimestampStr) {
          const lastTimestamp = parseInt(lastTimestampStr, 10);
          if (now - lastTimestamp < BRIEFING_COOLDOWN_MS) {
             return; // Still in cooldown
          }
        }
      } catch (e) {
        if (__DEV__) console.warn('[DailyBriefing] Failed to read timestamp', e);
      }
    }

    // 1. Reminders
    const activeReminders = tasks.filter(t => 
      t.state === 'scheduled' || t.state === 'pending' || t.state === 'triggered'
    );
    // Sort by scheduled time if available, otherwise creation
    activeReminders.sort((a, b) => {
      const aTime = a.scheduledFor || a.createdAt;
      const bTime = b.scheduledFor || b.createdAt;
      return aTime - bTime;
    });

    // 2. Unresolved Tasks & Meetings from Memory
    // We look at the most recent 50 memories to extract pending items
    const recentMemories = [...memories].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
    
    const unresolvedTasksSet = new Set<string>();
    const extractedMeetings: { title: string; participants?: string[] }[] = [];
    
    recentMemories.forEach(mem => {
      // Collect assignments / tasks
      if (mem.extractedTasks) {
        mem.extractedTasks.forEach(task => unresolvedTasksSet.add(task));
      }
      
      mem.conversationIntelligence?.forEach(intel => {
        // Collect meeting summaries
        if (intel.meetingSummary) {
          extractedMeetings.push({
            title: intel.meetingSummary,
            participants: intel.participants,
          });
        }
        
        // Collect action items
        if (intel.assignments) {
          intel.assignments.forEach(assignment => {
            unresolvedTasksSet.add(`${assignment.person} needs to ${assignment.responsibility}`);
          });
        }
      });
    });
    
    const unresolvedTasks = Array.from(unresolvedTasksSet).slice(0, 5); // Limit to top 5
    const uniqueMeetings = extractedMeetings.slice(0, 3);

    // 3. Greeting
    const greeting = generateGreeting(uniqueMeetings.length, unresolvedTasks.length, activeReminders.length);

    const newBriefing: BriefingData = {
      greeting,
      meetings: uniqueMeetings,
      reminders: activeReminders.slice(0, 5),
      unresolvedTasks,
      semanticPriorities: [], // placeholder for graph
      isActive: true,
      generatedAt: now,
    };

    setBriefing(newBriefing);
    setIsLoaded(true);

    try {
      await AsyncStorage.setItem(BRIEFING_TIMESTAMP_KEY, now.toString());
    } catch (e) {
      if (__DEV__) console.warn('[DailyBriefing] Failed to save timestamp', e);
    }
  }, [memories, tasks]);

  const dismissBriefing = useCallback(() => {
    setBriefing(prev => ({ ...prev, isActive: false }));
  }, []);

  // Try auto-generation on mount/load
  useEffect(() => {
    if (memories.length > 0 || tasks.length > 0) {
      generateBriefing();
    }
  }, [memories.length, tasks.length, generateBriefing]);

  return {
    briefing,
    isLoaded,
    generateBriefing,
    dismissBriefing,
  };
}
