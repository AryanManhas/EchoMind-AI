import type { ConversationMemory } from '../hooks/usePersistentMemory';

export type RetrievedMemory = {
  id: string;
  type: 'session' | 'reminder';
  title: string;
  summary: string;
  score: number;
  date: string;
  participants: string[];
  tasks: string[];
};

export class MemoryAgentService {
  /**
   * Normalizes the user's query by lowercasing and stripping excessive punctuation.
   */
  static normalizeQuery(query: string): string {
    return query.toLowerCase().replace(/[^\w\s-]/g, '').trim();
  }

  /**
   * A lightweight pseudo-semantic search across local memories and reminders.
   * Ranks items based on keywords, participants, projects, deadlines, and recency.
   */
  static retrieveContext(
    query: string,
    memories: ConversationMemory[],
    reminders: any[],
    maxResults: number = 5
  ): RetrievedMemory[] {
    const normalizedQuery = this.normalizeQuery(query);
    if (!normalizedQuery) return [];

    const keywords = normalizedQuery.split(' ').filter(k => k.length > 2);
    
    // Check for specific intent boosters
    const isSeekingReminder = /\b(remind|reminder|pending|task|todo)\b/.test(normalizedQuery);
    const isSeekingMeeting = /\b(meet|meeting|discuss|say|said|talk)\b/.test(normalizedQuery);
    const isSeekingDeadline = /\b(when|deadline|due)\b/.test(normalizedQuery);

    const scoredItems: RetrievedMemory[] = [];

    // 1. Process Memories
    for (const mem of memories) {
      let score = 0;
      
      const titleLower = (mem.sessionTitle || '').toLowerCase();
      const summaryLower = (mem.semanticSummary || mem.mergedTranscript || '').toLowerCase();
      const highlightsLower = (mem.highlights || []).join(' ').toLowerCase();
      const participantsLower = (mem.participants || []).join(' ').toLowerCase();
      const tasksLower = (mem.extractedTasks || []).join(' ').toLowerCase();
      
      const fullText = `${titleLower} ${summaryLower} ${highlightsLower} ${participantsLower} ${tasksLower}`;

      // Keyword matching
      let matchCount = 0;
      for (const kw of keywords) {
        if (titleLower.includes(kw)) {
          score += 5; // Title match gets strong boost
          matchCount++;
        } else if (participantsLower.includes(kw)) {
          score += 4; // Participant match
          matchCount++;
        } else if (tasksLower.includes(kw)) {
          score += 3; // Task match
          matchCount++;
        } else if (fullText.includes(kw)) {
          score += 1;
          matchCount++;
        }
      }

      // If no keywords matched and query isn't explicitly broad, skip
      if (matchCount === 0 && keywords.length > 0) continue;

      // Intent boosters
      if (isSeekingMeeting && (mem.sessionType === 'meeting' || mem.participants?.length > 0)) {
        score += 3;
      }
      if (isSeekingReminder && (mem.reminders?.length > 0 || mem.extractedTasks?.length > 0)) {
        score += 3;
      }

      // Temporal context: slight boost for recent items (within last 7 days)
      const daysOld = (Date.now() - new Date(mem.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysOld < 7) score += (7 - daysOld) * 0.2; 

      if (score > 0) {
        scoredItems.push({
          id: mem.sessionId || mem.id,
          type: 'session',
          title: mem.sessionTitle || 'Conversation',
          summary: mem.semanticSummary || mem.mergedTranscript || '',
          score,
          date: new Date(mem.createdAt).toISOString(),
          participants: mem.participants || [],
          tasks: mem.extractedTasks || []
        });
      }
    }

    // 2. Process Reminders
    for (const rem of reminders) {
      let score = 0;
      const titleLower = (rem.title || rem.task || '').toLowerCase();
      
      for (const kw of keywords) {
        if (titleLower.includes(kw)) score += 5;
      }

      if (score > 0 || (isSeekingReminder && !rem.completed)) {
        if (isSeekingReminder && !rem.completed) score += 4;
        if (isSeekingDeadline && rem.dueDate) score += 4;

        scoredItems.push({
          id: rem.id,
          type: 'reminder',
          title: `Reminder: ${rem.title || rem.task}`,
          summary: `Status: ${rem.completed ? 'Completed' : 'Pending'}${rem.dueDate ? `, Due: ${new Date(rem.dueDate).toLocaleString()}` : ''}`,
          score,
          date: new Date(rem.createdAt).toISOString(),
          participants: [],
          tasks: [rem.title || rem.task]
        });
      }
    }

    // Sort by score descending and take maxResults
    return scoredItems.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  /**
   * Constructs the structured prompt for Gemini using the retrieved local memory context.
   */
  static buildPrompt(query: string, retrievedContext: RetrievedMemory[]): { systemInstruction: string; userPrompt: string } {
    const contextString = retrievedContext.length === 0 
      ? 'No specific local memories found matching this query.' 
      : retrievedContext.map(c => `
--- 
Source: ${c.title} (${c.type})
Date: ${new Date(c.date).toLocaleString()}
Participants: ${c.participants.length > 0 ? c.participants.join(', ') : 'None'}
Summary: ${c.summary}
Key Tasks: ${c.tasks.length > 0 ? c.tasks.join('; ') : 'None'}
`).join('\n');

    const systemInstruction = `You are EchoMind AI, an intelligent conversational memory assistant (a second brain).
Your goal is to answer the user's question accurately using ONLY the provided local memories context.
Be conversational, concise, and structured. 
Use bullet points for lists if appropriate.
If the answer is not in the provided memories, politely say that you cannot find that information in their stored memories.
Do not invent information. Do not act like a generic AI, act specifically as their personal memory assistant returning information they previously recorded or discussed.`;

    const userPrompt = `User Query: "${query}"

Here are the most relevant local memories retrieved from the user's EchoMind vault:
${contextString}

Please synthesize an answer based on these memories.`;

    return { systemInstruction, userPrompt };
  }
}
