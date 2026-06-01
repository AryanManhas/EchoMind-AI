import { useCallback, useEffect, useRef, useState } from 'react';

export type SemanticExtractionType =
  | 'reminder'
  | 'meeting_action'
  | 'follow_up'
  | 'general_note'
  | 'calendar_event';

export type SemanticExtractionResult = {
  type: SemanticExtractionType;
  task: string;
  datetime?: string;
  participants?: string[];
  confidence: number;
  scores?: {
    actionability: number;
    temporal: number;
    explicitIntent: number;
    ownership: number;
  };
  sourceSessionId: string;
  rawText: string;
};

export type UseSemanticExtractionReturn = {
  extraction: SemanticExtractionResult | null;
  extractionCount: number;
  extractSemanticIntent: (text: string, sessionId: string) => void;
  extractSemanticIntentSync: (text: string, sessionId: string) => SemanticExtractionResult | null;
  resetExtraction: () => void;
};

function parseRelativeOrAbsoluteTime(text: string): { datetime?: string; confidence: number } {
  const lower = text.toLowerCase();
  const now = new Date();
  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  const resolveUpcomingWeekday = (day: string, hour = 9, minute = 0) => {
    const targetDayIndex = daysOfWeek.indexOf(day);
    const currentDayIndex = now.getDay();
    let offset = targetDayIndex - currentDayIndex;
    if (offset <= 0) offset += 7;
    const targetDate = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    targetDate.setHours(hour, minute, 0, 0);
    return targetDate;
  };
  
  // Match "in X minutes" or "in X mins"
  const inMinsMatch = lower.match(/in\s+(\d+)\s*(?:minutes?|mins?)/);
  if (inMinsMatch) {
    const mins = parseInt(inMinsMatch[1], 10);
    const targetDate = new Date(now.getTime() + mins * 60 * 1000);
    return { datetime: targetDate.toISOString(), confidence: 0.98 };
  }

  // Match "in X hours"
  const inHoursMatch = lower.match(/in\s+(\d+)\s*(?:hours?|hrs?)/);
  if (inHoursMatch) {
    const hours = parseInt(inHoursMatch[1], 10);
    const targetDate = new Date(now.getTime() + hours * 60 * 60 * 1000);
    return { datetime: targetDate.toISOString(), confidence: 0.98 };
  }

  // Match "tonight" or "this evening"
  if (lower.includes('tonight') || lower.includes('this evening')) {
    const targetDate = new Date(now);
    targetDate.setHours(20, 0, 0, 0); // Default to 8 PM
    if (targetDate.getTime() <= now.getTime()) {
      targetDate.setDate(targetDate.getDate() + 1); // fallback to next day 8 PM if it's already past 8 PM
    }
    return { datetime: targetDate.toISOString(), confidence: 0.95 };
  }

  // Match "next Monday/Tuesday/etc"
  const nextDayMatch = lower.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (nextDayMatch) {
    const targetDate = resolveUpcomingWeekday(nextDayMatch[1]);
    return { datetime: targetDate.toISOString(), confidence: 0.95 };
  }

  // Match "before Friday", "by Friday morning", or "on Friday"
  const weekdayMatch = lower.match(/(?:before|by|on|for)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(morning|afternoon|evening|night))?/);
  if (weekdayMatch) {
    const partOfDay = weekdayMatch[2];
    const hour = partOfDay === 'evening' || partOfDay === 'night'
      ? 18
      : partOfDay === 'afternoon'
        ? 14
        : 9;
    const targetDate = resolveUpcomingWeekday(weekdayMatch[1], hour);
    return { datetime: targetDate.toISOString(), confidence: 0.9 };
  }

  // Match "before 6 PM" or "by 6:30 PM"
  const deadlineTimeMatch = lower.match(/(?:before|by)\s+(\d+)(?::(\d+))?\s*(am|pm)?/);
  if (deadlineTimeMatch) {
    const targetDate = new Date(now);
    let hours = parseInt(deadlineTimeMatch[1], 10);
    const minutes = deadlineTimeMatch[2] ? parseInt(deadlineTimeMatch[2], 10) : 0;
    const ampm = deadlineTimeMatch[3];
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    targetDate.setHours(hours, minutes, 0, 0);
    if (targetDate.getTime() <= now.getTime()) {
      targetDate.setDate(targetDate.getDate() + 1);
    }
    return { datetime: targetDate.toISOString(), confidence: 0.9 };
  }

  // Contextual times
  if (lower.includes('after the meeting') || lower.includes('before presentation')) {
    const targetDate = new Date(now);
    targetDate.setHours(17, 0, 0, 0); // Default contextual reminders to EOD (5 PM)
    if (targetDate.getTime() <= now.getTime()) {
       targetDate.setHours(targetDate.getHours() + 2); // just add 2 hours if past 5 PM
    }
    return { datetime: targetDate.toISOString(), confidence: 0.85 };
  }

  // Match "tomorrow at X PM/AM" or "tomorrow at X:Y"
  const tomorrowMatch = lower.includes('tomorrow');
  if (tomorrowMatch) {
    const targetDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const timeMatch = lower.match(/at\s+(\d+)(?::(\d+))?\s*(am|pm)?/);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const ampm = timeMatch[3];
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      targetDate.setHours(hours, minutes, 0, 0);
    } else {
      targetDate.setHours(9, 0, 0, 0); // default to 9 AM tomorrow
    }
    return { datetime: targetDate.toISOString(), confidence: 0.95 };
  }

  // Match "at X:Y PM/AM" or "at X PM/AM" or "for X:Y PM/AM"
  const timeMatch = lower.match(/(?:at|for)\s+(\d+)(?::(\d+))?\s*(am|pm)?/);
  if (timeMatch) {
    const targetDate = new Date();
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3];
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    targetDate.setHours(hours, minutes, 0, 0);
    
    // If target time already passed today, schedule for tomorrow
    if (targetDate.getTime() <= now.getTime()) {
      targetDate.setDate(targetDate.getDate() + 1);
    }
    return { datetime: targetDate.toISOString(), confidence: 0.90 };
  }

  return { confidence: 0.7 };
}

function cleanTaskTitle(text: string): string {
  let cleaned = text
    .replace(/\b(hey|okay|hi|hello)\s*(echomind|echo\s*mind|mind)?\b/gi, '')
    .replace(/\b(set\s+a\s+reminder\s+for|set\s+a\s+reminder|set\s+reminder|remind\s+me\s+to|remind\s+me|remind\s+us|don't\s+let\s+me\s+forget\s+to|don't\s+let\s+me\s+forget|forget|wake\s+me|notify\s+me\s+to|notify\s+me|alert\s+me|meeting\s+at)\b/gi, '')
    .replace(/\b(tomorrow|today|tonight|this\s+evening|next\s+\w+|in\s+\d+\s*(?:minutes?|mins?|hours?|hrs?)|at\s+\d+(?::\d+)?\s*(?:am|pm)?|for\s+\d+(?::\d+)?\s*(?:am|pm)?|before\s+\w+(?:\s+(?:morning|evening|night|afternoon))?|by\s+\w+(?:\s+(?:morning|evening|night|afternoon))?|on\s+\w+(?:\s+(?:morning|evening|night|afternoon))?)\b/gi, '')
    .replace(/\bto\b/gi, '')
    .replace(/\b(about|on)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (cleaned.length === 0) {
    return 'Reminder';
  }
  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function isFalsePositive(text: string): boolean {
  const lower = text.toLowerCase().trim();
  // Too short to be actionable
  if (lower.length < 3) return true;
  
  // Just conversational filler
  const fillers = [
    'okay', 'ok', 'yes', 'no', 'fine', 'sure', 'alright', 'got it', 'thanks',
    'okay that\'s fine', 'yeah', 'yep', 'nope', 'detection', 'understood',
    'sounds good', 'awesome', 'great', 'cool'
  ];
  
  if (fillers.includes(lower)) return true;
  
  // Also if it's very short and starts with okay
  if (lower.startsWith('okay ') && lower.length < 15) return true;

  return false;
}

const EXPLICIT_REMINDER_PATTERN =
  /\b(remind\s+(?:me|us)|set\s+(?:a\s+)?reminder|schedule\s+(?:a\s+)?reminder|don't\s+(?:let\s+me\s+)?forget|notify\s+me|alert\s+me|wake\s+me|yaad\s+dila)\b/i;
const STRONG_COMMITMENT_PATTERN =
  /\b(i(?:'ll| will)|we(?:'ll| will)|need to|needs to|have to|must|should\s+(?:complete|finish|submit|review|finalize|prepare|send|call|deploy|deliver)|should be done|deadline|action item|follow up|follow-up)\b/i;
const ACTION_VERB_PATTERN =
  /\b(finish|complete|submit|review|finalize|prepare|send|call|deploy|deliver|schedule|book|write|create|fix|follow up|follow-up|check|update|share|handle)\b/i;
const LOW_CONFIDENCE_MEMORY_PATTERN =
  /\b(looks good|seems stable|discussed|talked about|had a meeting|handles?\s+\w+|is responsible for|that's fine|that is fine)\b/i;
const OWNER_PATTERN =
  /\b([A-Z][a-z]+|I|We)\s+(?:should|must|needs?\s+to|will|shall|can|has\s+to|have\s+to|is\s+going\s+to|should\s+(?:complete|finish))\s+([^.!?]{3,140})/;

function scoreIntent(text: string, parsedTime: { datetime?: string; confidence: number }) {
  const lower = text.toLowerCase();
  const explicitIntent = EXPLICIT_REMINDER_PATTERN.test(text) ? 1 : lower.includes('reminder') ? 0.85 : 0;
  const temporal = parsedTime.datetime
    ? Math.max(0.85, parsedTime.confidence)
    : /\b(before|by|deadline|tonight|tomorrow|today|eod|end of day|friday|monday|tuesday|wednesday|thursday|saturday|sunday|evening|morning)\b/i.test(text)
      ? 0.7
      : 0;
  const ownership = OWNER_PATTERN.test(text) || /\b(i(?:'ll| will)|we(?:'ll| will))\b/i.test(text) ? 0.9 : 0;
  const actionability = ACTION_VERB_PATTERN.test(text) || STRONG_COMMITMENT_PATTERN.test(text)
    ? STRONG_COMMITMENT_PATTERN.test(text) ? 0.9 : 0.7
    : 0;
  const lowConfidence = LOW_CONFIDENCE_MEMORY_PATTERN.test(text);

  return {
    actionability: lowConfidence ? Math.min(actionability, 0.25) : actionability,
    temporal,
    explicitIntent,
    ownership: lowConfidence ? 0 : ownership,
  };
}

function extractParticipantsFromOwnership(text: string): string[] {
  const match = text.match(OWNER_PATTERN);
  if (!match?.[1]) return [];
  const owner = match[1].toLowerCase() === 'i' || match[1].toLowerCase() === 'we'
    ? 'Aryan'
    : match[1];

  // Exclude temporal words from being classified as participants
  const stopWords = ['friday', 'monday', 'tuesday', 'wednesday', 'thursday', 'saturday', 'sunday', 'tomorrow', 'today', 'tonight', 'next'];
  if (stopWords.includes(owner.toLowerCase())) {
    return [];
  }

  return [owner];
}

function canPromoteReminder(scores: ReturnType<typeof scoreIntent>): boolean {
  return scores.explicitIntent >= 0.85 && (scores.temporal >= 0.65 || scores.actionability >= 0.7);
}

function canPromoteAction(scores: ReturnType<typeof scoreIntent>): boolean {
  return scores.actionability >= 0.75 && (
    scores.temporal >= 0.65 ||
    scores.ownership >= 0.75 ||
    scores.explicitIntent >= 0.85
  );
}
function canPromoteCalendarEvent(scores: ReturnType<typeof scoreIntent>, text: string): boolean {
  return scores.temporal >= 0.85 && /\b(meeting|presentation|appointment|schedule|call|interview)\b/i.test(text);
}

export function useSemanticExtraction(): UseSemanticExtractionReturn {
  const [extraction, setExtraction] = useState<SemanticExtractionResult | null>(null);
  const [extractionCount, setExtractionCount] = useState(0);
  const lastExtractedSessionIdRef = useRef<string | null>(null);

  const extractSemanticIntentSync = useCallback((text: string, sessionId: string): SemanticExtractionResult | null => {
    if (!text.trim()) return null;

    if (isFalsePositive(text)) {
      return {
        type: 'general_note',
        task: '',
        confidence: 0.1,
        scores: {
          actionability: 0,
          temporal: 0,
          explicitIntent: 0,
          ownership: 0,
        },
        sourceSessionId: sessionId,
        rawText: text,
      };
    }

    const lowerText = text.toLowerCase();
    const parsedTime = parseRelativeOrAbsoluteTime(text);
    const scores = scoreIntent(text, parsedTime);
    const cleanedTitle = cleanTaskTitle(text);
    const participants = extractParticipantsFromOwnership(text);

    let result: SemanticExtractionResult = {
      type: 'general_note',
      task: text,
      confidence: 0.5,
      scores,
      sourceSessionId: sessionId,
      rawText: text,
    };

    if (canPromoteCalendarEvent(scores, lowerText) && parsedTime.datetime) {
      result = {
        type: 'calendar_event',
        task: cleanedTitle,
        datetime: parsedTime.datetime,
        participants,
        confidence: 0.95,
        scores,
        sourceSessionId: sessionId,
        rawText: text,
      };
    } else if (canPromoteReminder(scores)) {
      result = {
        type: 'reminder',
        task: cleanedTitle,
        datetime: parsedTime.datetime,
        participants,
        confidence: parsedTime.datetime ? 0.98 : 0.9,
        scores,
        sourceSessionId: sessionId,
        rawText: text,
      };
    } else if (canPromoteAction(scores) && (lowerText.includes('meeting') || participants.length > 0)) {
      result = {
        type: 'meeting_action',
        task: cleanedTitle,
        datetime: parsedTime.datetime,
        participants,
        confidence: parsedTime.datetime ? 0.92 : 0.86,
        scores,
        sourceSessionId: sessionId,
        rawText: text,
      };
    } else if (canPromoteAction(scores)) {
      result = {
        type: 'follow_up',
        task: cleanedTitle,
        datetime: parsedTime.datetime,
        participants,
        confidence: parsedTime.datetime ? 0.9 : 0.82,
        scores,
        sourceSessionId: sessionId,
        rawText: text,
      };
    }

    if (result.type !== 'general_note' && result.task.length < 3) {
       result.type = 'general_note';
       result.confidence = 0.3;
    }

    return result;
  }, []);

  const extractSemanticIntent = useCallback((text: string, sessionId: string) => {
    if (!text.trim()) return;
    if (lastExtractedSessionIdRef.current === sessionId) {
      return; // Prevent duplicate extraction for the same session
    }
    
    lastExtractedSessionIdRef.current = sessionId;
    
    const result = extractSemanticIntentSync(text, sessionId);
    if (!result) return;

    
    setExtraction(result);
    setExtractionCount(c => c + 1);
  }, [extractSemanticIntentSync]);

  const resetExtraction = useCallback(() => {
    setExtraction(null);
    lastExtractedSessionIdRef.current = null;
  }, []);

  return {
    extraction,
    extractionCount,
    extractSemanticIntent,
    extractSemanticIntentSync,
    resetExtraction,
  };
}

export default useSemanticExtraction;
