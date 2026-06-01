import { useMemo, useRef } from 'react';
import type { ContextualRecallPayload } from './useContextualRecall';
import type { ConversationContinuationResult } from './useConversationContinuation';
import type { KnowledgeGraphSnapshot } from './useKnowledgeGraph';
import type { ProactiveAssistantSnapshot } from './useProactiveAssistant';
import type { SemanticExtractionResult } from './useSemanticExtraction';

export type ConversationalSynthesisInput = {
  recall: ContextualRecallPayload;
  continuation: ConversationContinuationResult;
  knowledgeGraph: Pick<KnowledgeGraphSnapshot, 'projectTimelines' | 'participants' | 'recurringTopics' | 'diagnostics'>;
  proactiveSignals: Pick<ProactiveAssistantSnapshot, 'topSignals' | 'diagnostics'>;
  semanticIntent: SemanticExtractionResult | null;
  currentUtterance: string;
};

export type ConversationalSynthesisPayload = {
  synthesisText: string;
  isSynthesized: boolean;
};

export function buildConversationalSynthesis(input: ConversationalSynthesisInput): ConversationalSynthesisPayload {
  const { recall, continuation, knowledgeGraph, proactiveSignals, semanticIntent } = input;
  
  const sentences: string[] = [];

  // 1. Premium conversational confirmations for semantic intent
  if (semanticIntent) {
    if (semanticIntent.type === 'reminder') {
      const phrases = ["I'll remind you.", "Got it.", "I'll keep track of that."];
      const index = Math.abs(semanticIntent.task.length) % phrases.length;
      sentences.push(phrases[index]);
    } else if (semanticIntent.type === 'meeting_action') {
      sentences.push("Got it. I'll note that task.");
    } else if (semanticIntent.type === 'follow_up') {
      sentences.push("I've noted the follow-up.");
    }
  }

  // 2. Active Continuation / Thread Resume (calm, clean, not chatty)
  const activeSnapshot = continuation.activeSnapshot;
  if (activeSnapshot) {
    if (activeSnapshot.unresolvedTasks.length > 0) {
      const task = activeSnapshot.unresolvedTasks[0].replace(/^(to )?/i, '');
      sentences.push(`We still have the open task to ${task}.`);
    } else if (activeSnapshot.pendingReminders.length > 0) {
      sentences.push(`You have a pending reminder: ${activeSnapshot.pendingReminders[0]}.`);
    } else if (activeSnapshot.activeTopics.length > 0) {
      sentences.push(`We can continue on ${activeSnapshot.activeTopics[0]}.`);
    }
  }

  // 3. Contextual Recall Matches (subtle references, not intrusive)
  if (recall.matches.length > 0 && (!activeSnapshot || recall.matches[0].memory.sessionId !== activeSnapshot.sessionId)) {
    const bestMatch = recall.matches[0];
    const participants = bestMatch.memory.participants || [];
    if (bestMatch.memory.sessionType === 'meeting') {
      const title = bestMatch.memory.sessionTitle || 'a meeting';
      sentences.push(`I remember our discussion about ${title}.`);
    } else if (participants.length > 0) {
      sentences.push(`I remember our discussion with ${participants[0]}.`);
    }
    
    // Linked Reminders from Recall
    if (bestMatch.reminders && bestMatch.reminders.length > 0) {
      sentences.push(`Don't forget: ${bestMatch.reminders[0].title}.`);
    }
  }

  // 4. Proactive Signals
  if (proactiveSignals.topSignals.length > 0) {
    const topSignal = proactiveSignals.topSignals[0];
    if (!sentences.some(s => s.includes(topSignal.title))) {
      if (topSignal.signalType === 'unresolved_task' || topSignal.signalType === 'overdue_reminder' || topSignal.signalType === 'deadline_warning') {
        sentences.push(`Just a quick note: ${topSignal.title.toLowerCase()}.`);
      } else if (topSignal.signalType === 'project_followup' || topSignal.signalType === 'collaborator_followup') {
        sentences.push(`You might want to check on ${topSignal.title.toLowerCase()}.`);
      }
    }
  }

  // 5. Knowledge Graph
  if (knowledgeGraph.recurringTopics && knowledgeGraph.recurringTopics.length > 0) {
    const topic = knowledgeGraph.recurringTopics[0];
    if (!sentences.some(s => s.toLowerCase().includes(topic.name.toLowerCase()))) {
      sentences.push(`${topic.name} is an ongoing focus.`);
    }
  }

  // Fallback
  if (sentences.length === 0) {
    if (!semanticIntent) {
      sentences.push("I'm listening. How can I help you?");
    }
  }

  // Cap at ~2 short sentences to remain concise and executive-premium
  const finalSentences = sentences.slice(0, 2);
  
  return {
    synthesisText: finalSentences.join(' '),
    isSynthesized: finalSentences.length > 0 && finalSentences[0] !== "I'm listening. How can I help you?"
  };
}

export function useConversationalSynthesis(input: ConversationalSynthesisInput): ConversationalSynthesisPayload {
  const cacheRef = useRef<{ key: string; payload: ConversationalSynthesisPayload } | null>(null);
  
  const key = [
    input.currentUtterance,
    input.semanticIntent?.type || 'none',
    input.recall.diagnostics.retrievedSessions,
    input.continuation.diagnostics.threadCount,
    input.proactiveSignals.topSignals.length
  ].join('::');

  return useMemo(() => {
    if (cacheRef.current?.key === key) {
      return cacheRef.current.payload;
    }
    const payload = buildConversationalSynthesis(input);
    cacheRef.current = { key, payload };
    return payload;
  }, [input, key]);
}
