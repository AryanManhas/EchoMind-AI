import type { ReminderTask } from '../hooks/useReminderEngine';

export type ProactiveNudge = {
  id: string;
  title: string;
  body: string;
  triggerAt: number;
};

// Generates 1 to 3 nudges before the actual event.
export function generateProactiveNudges(task: ReminderTask): ProactiveNudge[] {
  if (!task.scheduledFor || task.scheduledFor <= Date.now()) return [];

  const nudges: ProactiveNudge[] = [];
  const now = Date.now();
  const timeToEvent = task.scheduledFor - now;

  // We only generate proactive nudges if the event is at least 3 minutes away.
  if (timeToEvent < 3 * 60 * 1000) return [];

  const participants = task.metadata.participants?.join(', ');
  const topic = task.title;
  const isMeeting = task.type === 'meeting';

  // Helper to format time relative to now for a more natural feel
  const getRelativeTimeString = (offsetMs: number): string => {
    if (offsetMs <= 15 * 60 * 1000) return 'in 15 minutes';
    if (offsetMs <= 60 * 60 * 1000) return 'in 1 hour';
    return 'soon';
  };

  const generatePhrase = (offsetMs: number): { title: string, body: string } => {
    const timeStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(task.scheduledFor!));
    
    if (task.type === 'meeting') {
      return { 
        title: 'Meeting Preparation', 
        body: `${topic} begins ${getRelativeTimeString(offsetMs)}.` 
      };
    }
    
    if (task.type === 'follow_up') {
      return { 
        title: 'Pending Follow-Up', 
        body: `You still need to: ${topic.toLowerCase()}.` 
      };
    }

    if (task.type === 'reminder' || task.type === 'calendar_event') {
      // Check if it's a deadline-like phrase
      if (topic.toLowerCase().includes('due') || topic.toLowerCase().includes('deadline')) {
        return {
          title: 'Upcoming Deadline',
          body: `${topic} at ${timeStr}.`
        };
      }
      return { 
        title: 'Upcoming Reminder', 
        body: `${topic} starts at ${timeStr}.` 
      };
    }

    return { title: 'Upcoming Reminder', body: topic };
  };

  // Determine how many nudges to send (max 3)
  // If > 24 hours away, maybe 3 nudges (1 day before, 1 hour before, 10 mins before)
  // If > 2 hours away, maybe 2 nudges (1 hour before, 10 mins before)
  // If > 30 mins away, maybe 1-2 nudges
  // For simplicity, let's do:
  // Nudge 1: ~10% of the time remaining before the event (imminent)
  // Nudge 2: ~50% of the time remaining before the event (approaching)
  
  // We want to work backwards from the event time.
  const offsets = [];
  
  if (timeToEvent > 24 * 60 * 60 * 1000) {
    offsets.push(24 * 60 * 60 * 1000); // 1 day before
    offsets.push(60 * 60 * 1000); // 1 hour before
    offsets.push(10 * 60 * 1000); // 10 mins before
  } else if (timeToEvent > 2 * 60 * 60 * 1000) {
    offsets.push(60 * 60 * 1000); // 1 hour before
    offsets.push(10 * 60 * 1000); // 10 mins before
  } else if (timeToEvent > 30 * 60 * 1000) {
    offsets.push(15 * 60 * 1000); // 15 mins before
    offsets.push(5 * 60 * 1000); // 5 mins before
  } else {
    offsets.push(Math.floor(timeToEvent * 0.2)); // 20% of remaining time before event
  }

  offsets.forEach((offset, index) => {
    const triggerAt = task.scheduledFor! - offset;
    if (triggerAt > now) {
      const phrase = generatePhrase(offset);

      // Add a slight random jitter to the trigger time (-1 to +1 minute) to feel more natural,
      // but ensure it doesn't go past the actual scheduled time or before now.
      const jitter = Math.floor(Math.random() * 2 * 60 * 1000) - 60 * 1000;
      let finalTriggerAt = triggerAt + jitter;
      
      if (finalTriggerAt >= task.scheduledFor!) finalTriggerAt = task.scheduledFor! - 1000;
      if (finalTriggerAt <= now) finalTriggerAt = now + 1000;

      nudges.push({
        id: `${task.id}-nudge-${index}`,
        title: phrase.title,
        body: phrase.body,
        triggerAt: finalTriggerAt,
      });
    }
  });

  return nudges;
}
