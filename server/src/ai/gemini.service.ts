import { GoogleGenAI, Type } from '@google/genai';
import { createLogger } from '../utils/logger.js';
import { MemoryExtractionSchema, type MemoryExtraction } from '@echomind/types';
import { env } from '../config/env.js';
import { CONSTANTS } from '../config/constants.js';
import { detectLanguage, getLanguageInstruction, type SupportedLanguage } from '../nlp/language.service.js';
import { extractEntities } from '../nlp/entity-extractor.js';

export interface MeetingInsights {
  mainPoints: string[];
  decisions: string[];
  actionItems: Array<{ task: string; assignee: string; dueDate?: string }>;
  nextSteps: string[];
  blockers?: string[];
  followUps?: string[];
}

const log = createLogger('gemini');

// Initialize the new @google/genai client
const ai = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });

const EXPLICIT_REMINDER_PATTERN =
  /\b(remind\s+(?:me|us)|set\s+(?:a\s+)?reminder|schedule\s+(?:a\s+)?reminder|don't\s+(?:let\s+me\s+)?forget|notify\s+me|alert\s+me|wake\s+me|yaad\s+dila)\b/i;
const ACTIONABLE_COMMITMENT_PATTERN =
  /\b(i(?:'ll| will)|we(?:'ll| will)|need to|needs to|have to|must|should\s+(?:complete|finish|submit|review|finalize|prepare|send|call|deploy|deliver)|action item|follow up|follow-up|deadline)\b/i;
const TEMPORAL_PATTERN =
  /\b(deadline|due|by|before|tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|eod|end of day|evening|morning|\d{1,2}(?::\d{2})?\s?(?:am|pm))\b/i;

function hasReminderPromotionIntent(transcript: string, extraction: MemoryExtraction): boolean {
  const reminderConfidence = extraction.reminderConfidence ?? 0;
  const taskConfidence = extraction.taskConfidence ?? 0;
  const explicitReminder = EXPLICIT_REMINDER_PATTERN.test(transcript);
  const temporal = TEMPORAL_PATTERN.test(transcript) || (extraction.reminders && extraction.reminders.length > 0 && !!extraction.reminders[0].due_date);
  const actionable = ACTIONABLE_COMMITMENT_PATTERN.test(transcript);

  return (
    (explicitReminder && reminderConfidence >= 0.85 && temporal) ||
    (actionable && temporal && taskConfidence >= 0.9 && reminderConfidence >= 0.75)
  );
}

/**
 * Memory extraction using Gemini with bilingual support.
 * Detects language, applies NLP entity extraction, and generates structured output.
 *
 * Supported:
 * - Pure English
 * - Pure Hindi (Devanagari)
 * - Code-switched Hindi-English (Hinglish)
 */
export async function extractMemory(transcript: string): Promise<MemoryExtraction | null> {
  const now = new Date();
  const langResult = detectLanguage(transcript);
  const entities = extractEntities(transcript);
  const langInstruction = getLanguageInstruction(langResult.language);

  const systemPrompt = `You are the EchoMind Memory Engine — an intelligent "Second Brain" that works in both English and Hindi.

Current Time: ${now.toISOString()} (${now.toLocaleDateString('en-IN')} ${now.toLocaleTimeString('en-IN')})
You are analyzing a transcript. The current exact date and time is ${now.toISOString()}. You MUST convert any relative deadlines (e.g., 'tomorrow', 'Friday') into strict ISO-8601 timestamps.

Detected Language: ${langResult.language} (confidence: ${langResult.confidence.toFixed(2)})
Code-Switched: ${langResult.isCodeSwitched}

${langInstruction}

Pre-extracted entities:
- People: ${entities.people.join(', ') || 'none'}
- Dates: ${entities.dates.join(', ') || 'none'}
- Times: ${entities.times.join(', ') || 'none'}
- Tasks: ${entities.tasks.join(', ') || 'none'}
- Deadlines: ${entities.deadlines.join(', ') || 'none'}

INSTRUCTIONS:
1. Write a concise, declarative title (in the same language as the transcript).
2. Generate a highly synthesized, professional executive summary. Do NOT repeat filler speech, casual acknowledgements, repeated words, or conversational noise. Focus on key decisions, assignments, and follow-ups. If the transcript contains meeting discussions, decisions, action items, or deadlines, structure the summary into the following clear sections (in the same language as the transcript). DO NOT use raw transcript fragments. Write in concise, executive-style bullet points:
   Key Discussion Points:
   - [Point 1]
   - [Point 2]

   Decisions Taken:
   - [Decision 1]

   Action Items:
   - [Action 1 (include assignee name if mentioned, e.g., "Rahul to handle frontend")]

   Deadlines & Timings:
   - [STRICTLY use highly normalized temporal tokens (e.g., "Tomorrow • 4:00 PM" or "Friday Evening"). DO NOT use raw transcript fragments here!]

   Pending Follow-ups:
   - [Follow-up 1 (unresolved blockers or topics needing follow-up    If it is a simple note or short casual chat, provide a concise synthesized overview instead of these structured sections.
3. Categorize precisely. Choose the most fitting category:
   - "conversational": Standard chatter, greeting, conversational turns.
   - "reminder": Explicit request to be reminded of something at a future time.
   - "meeting_action": Explicit commitments or assigned action items, preferably with owner/deadline.
   - "personal_fact": Personal facts, preferences, dates of birth, likes/dislikes.
   - "ephemeral_context": Current locations, short-term states, temporal notes.
   - "semantic_observation": General observations or thoughts/ideas.
   - Fallbacks: "Task", "Fact", or "Idea".
4. Score importance: 0.0 to 1.0.
5. Extract 2-5 tags (English keywords for cross-language searchability).
6. Calculate confidence scores (0.0 to 1.0) for each dimension:
   - reminderConfidence: High only if explicit reminder intent exists OR a strong actionable commitment has a clear future deadline.
   - taskConfidence: High only when there is a concrete action verb plus owner/commitment/deadline.
   - conversationalConfidence: High if it's general talking, story, check-in, or greeting.
   - meetingConfidence: High if it represents a meeting summary, action item assignment, or collective decision.
7. projects: Ignore filler words. Only extract explicit project names. If none exist, return null or an empty array.
8. participants: ONLY proper noun human names.
9. reminders: Must be an array of objects containing { description: string, due_date: ISO8601_string }.

EXAMPLES:
- "Remind me tomorrow to call Rahul" → category: "reminder", reminderConfidence: 1.0, taskConfidence: 0.9, conversationalConfidence: 0.1, meetingConfidence: 0.0 (DO populate reminders array).
- "Rahul called me yesterday" → category: "conversational", reminderConfidence: 0.0, taskConfidence: 0.0, conversationalConfidence: 0.9, meetingConfidence: 0.0 (DO NOT populate reminders).
- "We need to finalize the Q3 targets by next Monday" → category: "meeting_action", reminderConfidence: 0.8, taskConfidence: 0.95, conversationalConfidence: 0.2, meetingConfidence: 0.8.
- "We discussed frontend deployment" → category: "semantic_observation", reminderConfidence: 0.0, taskConfidence: 0.0, conversationalConfidence: 0.9 (DO NOT populate reminders).
- "Okay that's fine" → category: "conversational", reminderConfidence: 0.0, taskConfidence: 0.0, conversationalConfidence: 1.0 (DO NOT populate reminders).
- "Rahul handles frontend" → category: "personal_fact" or "semantic_observation", reminderConfidence: 0.0, taskConfidence: 0.0 (DO NOT populate reminders).

REMINDER EXTRACTION:
Extract "reminders" ONLY when explicit reminder intent exists OR a strong actionable commitment has a clear future date/time/deadline. Otherwise preserve it as memory without reminders.
- due_date: ISO 8601 datetime. Resolve relative dates using Current Time (${now.toISOString()}).
- "kal" / "tomorrow" → tomorrow same time
- "agle hafte" / "next week" → next Monday
- "5 baje" → today/tomorrow at 5:00 PM`;

  try {
    const response = await ai.models.generateContent({
      model: CONSTANTS.GEMINI_MODEL,
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'user', parts: [{ text: `Transcript: "${transcript}"` }] },
      ],
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            category: { type: Type.STRING },
            importance: { type: Type.NUMBER },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            projects: { type: Type.ARRAY, items: { type: Type.STRING } },
            participants: { type: Type.ARRAY, items: { type: Type.STRING } },
            reminderConfidence: { type: Type.NUMBER },
            taskConfidence: { type: Type.NUMBER },
            conversationalConfidence: { type: Type.NUMBER },
            meetingConfidence: { type: Type.NUMBER },
            reminders: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  description: { type: Type.STRING },
                  due_date: { type: Type.STRING, description: 'ISO 8601' },
                },
                required: ['description', 'due_date'],
              },
            },
          },
          required: ['title', 'summary', 'category', 'importance'],
        },
      },
    });

    const text = response.text;
    if (!text) {
      log.warn('Gemini returned empty response');
      return null;
    }

    const rawJson = JSON.parse(text);
    const parsed = MemoryExtractionSchema.safeParse(rawJson);

    if (parsed.success) {
      const data = parsed.data;
      // Post-process to enforce strict semantic memory vs reminder promotion.
      if (data.reminders && data.reminders.length > 0 && !hasReminderPromotionIntent(transcript, data as any)) {
        data.reminders = [];
      }
      
      if (!Array.isArray(data.reminders)) {
        data.reminders = [];
      }

      console.log('Extracted Reminders:', data.reminders);

      log.info({
        language: langResult.language,
        category: data.category,
        hasReminders: data.reminders && data.reminders.length > 0,
      }, 'Memory extracted');
      return data;
    }

    // Fallback for partial Zod failures
    log.warn({ errors: parsed.error.errors }, 'Zod validation failed — applying fallback');
    return {
      title: rawJson.title || 'Captured Memory',
      summary: rawJson.summary || transcript.substring(0, 200),
      category: ['Task', 'Fact', 'Idea'].includes(rawJson.category) ? rawJson.category : 'Fact',
      importance: typeof rawJson.importance === 'number' ? rawJson.importance : 0.5,
      tags: Array.isArray(rawJson.tags) ? rawJson.tags : [],
      reminderConfidence: 0,
      taskConfidence: 0,
      conversationalConfidence: 0,
      meetingConfidence: 0,
      projects: [],
      participants: [],
      reminders: [],
    };
  } catch (error) {
    if (env.DEMO_MODE) {
      log.warn('DEMO_MODE: Returning mock memory');
      return {
        title: langResult.language === 'en' ? 'Research Neural Interfaces' : 'न्यूरल इंटरफेस रिसर्च',
        summary: 'Explored advancements in brain-computer interfaces.',
        category: 'Idea',
        importance: 0.95,
        tags: ['research', 'neural', 'AI'],
        reminderConfidence: 0,
        taskConfidence: 0,
        conversationalConfidence: 0,
        meetingConfidence: 0,
        projects: [],
        participants: [],
        reminders: [],
      };
    }
    log.error({ error }, 'Failed to extract memory');
    return null;
  }
}

/**
 * Answer a user query using memory context.
 * Supports bilingual queries like "Meri kal ki reminders kya hain?"
 */
export async function answerQuery(
  query: string,
  memoryContext: string,
  language: SupportedLanguage = 'en',
): Promise<string | null> {
  const langInstruction = getLanguageInstruction(language);

  try {
    const response = await ai.models.generateContent({
      model: CONSTANTS.GEMINI_MODEL,
      contents: [{
        role: 'user',
        parts: [{
          text: `You are EchoMind, a bilingual AI memory assistant.
${langInstruction}
Respond in the same language as the query. Be concise and helpful.

User's Memory Context:
${memoryContext}

User Query: "${query}"

Answer based ONLY on the provided memory context. If you don't have enough information, say so honestly.`
        }]
      }],
    });

    return response.text || null;
  } catch (error) {
    log.error({ error }, 'Failed to answer query');
    return null;
  }
}

/**
 * Specialized extraction for long-form meeting transcripts.
 * Focuses on diarized context, speaker dynamics, and project-level insights.
 */
export async function extractMeetingInsights(transcript: string): Promise<MeetingInsights | null> {
  const systemPrompt = `You are the EchoMind Meeting Analyst. Your goal is to process a meeting transcript (potentially with multiple speakers) and extract high-level strategic insights.

INSTRUCTIONS:
1. Identify the 3-5 most critical "Main Points" discussed. Write in concise, executive-style bullet points. DO NOT use raw transcript fragments.
2. List any specific "Decisions" that were finalized during the meeting.
3. Extract "Action Items" including the task description, the person assigned (the owner), and any deadlines.
   - For ownership: strictly extract the correct owner name. If the transcript says "I'll do X" or "we need to Y", map it to the active speaker's name (e.g. 'Aryan' or speaker name), or use 'Aryan' as the default owner, or 'unassigned' if unclear.
4. Summarize the "Next Steps" for the team.
5. Extract any unresolved "Blockers" or dependencies mentioned.
6. Extract any pending "Follow-ups" that need to be revisited.

If the transcript is in Hindi or Hinglish, provide the insights in the same language style but ensure the structure remains JSON.

FORMAT:
Provide the output in a clean JSON object matching the requested schema.`;

  try {
    const response = await ai.models.generateContent({
      model: CONSTANTS.GEMINI_MODEL,
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'user', parts: [{ text: `Meeting Transcript:\n${transcript}` }] },
      ],
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: Type.OBJECT,
          properties: {
            mainPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            decisions: { type: Type.ARRAY, items: { type: Type.STRING } },
            actionItems: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  task: { type: Type.STRING },
                  assignee: { type: Type.STRING },
                  dueDate: { type: Type.STRING },
                },
                required: ['task', 'assignee'],
              },
            },
            nextSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
            blockers: { type: Type.ARRAY, items: { type: Type.STRING } },
            followUps: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['mainPoints', 'decisions', 'actionItems', 'nextSteps', 'blockers', 'followUps'],
        },
      },
    });

    const text = response.text;
    return text ? JSON.parse(text) : null;
  } catch (error) {
    log.error({ error }, 'Failed to extract meeting insights');
    return null;
  }
}

/**
 * Extract useful context or entities from text (legacy debug helper).
 */
export async function extractContext(text: string) {
  try {
    const response = await ai.models.generateContent({
      model: CONSTANTS.GEMINI_MODEL,
      contents: [{
        role: 'user',
        parts: [{ text: `Extract useful context or entities from the following text and summarize them concisely:\n\n"${text}"` }]
      }]
    });
    return { context: response.text };
  } catch (error: any) {
    log.error({ error }, 'Failed to extract context');
    return { context: null, error: error.message || 'Extraction failed' };
  }
}

// ─── Calendar Event Extraction ────────────────────────────────────

export interface ExtractedCalendarEvent {
  summary: string;
  description?: string;
  startTime: string;
  endTime?: string;
  location?: string;
  isAllDay: boolean;
  timeZone?: string;
  recurrence?: string[];
  confidence: number;
}

/**
 * Analyze a transcript/memory for calendar-worthy events.
 * Returns structured event data if a time-bound event is detected.
 *
 * Examples:
 * - "Flight to NYC on June 15 at 3pm" → { summary: "Flight to NYC", startTime: "2026-06-15T15:00:00", ... }
 * - "Meeting with Rahul next Monday at 2pm" → calendar event
 * - "Remember to buy groceries" → null (no time-bound event)
 */
export async function extractCalendarEvent(
  transcript: string,
  existingTitle?: string,
): Promise<ExtractedCalendarEvent | null> {
  const now = new Date();

  const systemPrompt = `You are the EchoMind Calendar Analyzer. Your job is to detect if a transcript contains a CALENDAR-WORTHY EVENT — something with a specific date/time that should appear on a user's Google Calendar.

Current Date/Time: ${now.toISOString()} (${now.toLocaleDateString('en-IN')} ${now.toLocaleTimeString('en-IN')})
Day of Week: ${now.toLocaleDateString('en-US', { weekday: 'long' })}

RULES:
1. Only extract events with a CLEAR date or time reference. Vague "sometime" references → return hasEvent: false.
2. Resolve relative dates:
   - "tomorrow" → ${new Date(now.getTime() + 86400000).toISOString().split('T')[0]}
   - "next Monday" → calculate from current day
   - "kal" (Hindi for tomorrow) → same as "tomorrow"
   - "next week" → next Monday
3. If no end time is specified, assume 1 hour duration.
4. For flights/travel, set the end time to include travel duration if mentioned.
5. "All day" events: birthdays, holidays, deadlines without specific times.
6. Return a confidence score (0.0-1.0). Must be ≥ 0.7 to create an event.

EXAMPLES:
- "Flight to NYC on June 15 at 3pm" → hasEvent: true, summary: "Flight to NYC", startTime: "2026-06-15T15:00:00"
- "Dentist appointment Thursday 10am" → hasEvent: true, summary: "Dentist Appointment"
- "Rahul's birthday is on March 22" → hasEvent: true, isAllDay: true
- "I need to buy milk" → hasEvent: false
- "The meeting went well yesterday" → hasEvent: false (past event, don't create)`;

  try {
    const response = await ai.models.generateContent({
      model: CONSTANTS.GEMINI_MODEL,
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'user', parts: [{ text: `Transcript: "${transcript}"${existingTitle ? `\nContext title: "${existingTitle}"` : ''}` }] },
      ],
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: Type.OBJECT,
          properties: {
            hasEvent: { type: Type.BOOLEAN, description: 'Whether a calendar event was detected' },
            summary: { type: Type.STRING },
            description: { type: Type.STRING },
            startTime: { type: Type.STRING, description: 'ISO 8601 datetime' },
            endTime: { type: Type.STRING, description: 'ISO 8601 datetime' },
            location: { type: Type.STRING },
            isAllDay: { type: Type.BOOLEAN },
            timeZone: { type: Type.STRING },
            recurrence: { type: Type.ARRAY, items: { type: Type.STRING } },
            confidence: { type: Type.NUMBER, description: '0.0 to 1.0' },
          },
          required: ['hasEvent', 'confidence'],
        },
      },
    });

    const text = response.text;
    if (!text) {
      log.warn('Gemini returned empty response for calendar extraction');
      return null;
    }

    const result = JSON.parse(text);

    if (!result.hasEvent || result.confidence < 0.7) {
      log.debug({ confidence: result.confidence }, 'No calendar event detected (below threshold)');
      return null;
    }

    log.info({
      summary: result.summary,
      confidence: result.confidence,
      startTime: result.startTime,
    }, 'Calendar event extracted from transcript');

    return {
      summary: result.summary,
      description: result.description,
      startTime: result.startTime,
      endTime: result.endTime,
      location: result.location,
      isAllDay: result.isAllDay || false,
      timeZone: result.timeZone || 'Asia/Kolkata',
      recurrence: result.recurrence,
      confidence: result.confidence,
    };
  } catch (error) {
    log.error({ error }, 'Failed to extract calendar event');
    return null;
  }
}
