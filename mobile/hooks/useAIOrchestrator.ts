import { useCallback, useRef, useState } from 'react';
import type { ConversationMemory } from './usePersistentMemory';
import type { ReminderTask } from './useReminderEngine';
import type { SemanticExtractionResult } from './useSemanticExtraction';
import type { ConversationSessionSnapshot } from './useConversationSession';
import {
  buildContextualRecallPayload,
  type ContextualRecallDiagnostics,
} from './useContextualRecall';
import { buildContinuationPayload } from './useConversationContinuation';
import {
  buildKnowledgeGraphSnapshot,
  type KnowledgeGraphSnapshot,
} from './useKnowledgeGraph';
import {
  buildProactiveAssistantSnapshot,
  type ProactiveAssistantSnapshot,
} from './useProactiveAssistant';
import {
  assembleBoundedPromptSections,
  pruneKnowledgeGraphForRuntime,
} from './useRuntimeHealth';
import { buildConversationalSynthesis } from './useConversationalSynthesis';

export type OrchestratorState = 'idle' | 'assembling' | 'ready';

export type OrchestratorContext = {
  systemDirectives: string;
  recentMemories: string;
  activeReminders: string;
  contextualRecall: string;
  continuationContext: string;
  knowledgeGraphContext: string;
  knowledgeGraph: Pick<KnowledgeGraphSnapshot, 'projectTimelines' | 'participants' | 'recurringTopics' | 'diagnostics'>;
  proactiveContext: string;
  proactiveDigest: string;
  proactiveSignals: Pick<ProactiveAssistantSnapshot, 'topSignals' | 'diagnostics'>;
  recallDiagnostics: ContextualRecallDiagnostics;
  semanticIntent: SemanticExtractionResult | null;
  currentUtterance: string;
  bilingualContext: {
    localeHints: any;
  };
  localSynthesis: string;
};

export type UseAIOrchestratorReturn = {
  orchestratorState: OrchestratorState;
  latestContextPayload: OrchestratorContext | null;
  assembleContext: (
    session: ConversationSessionSnapshot,
    memories: ConversationMemory[],
    reminders: ReminderTask[],
    semanticExtraction: SemanticExtractionResult | null
  ) => void;
  resetOrchestrator: () => void;
};

const BILINGUAL_SYSTEM_PROMPT = `
You are EchoMind, a calm, intelligent, and premium conversational AI companion.
Personality & Tone:
- Be intentionally calm, emotionally neutral-positive, and fluid.
- Avoid robotic phrasing, over-excited tones, and generic chatbot wording (e.g., "How can I help you today?").
- Be concise but thoughtful. Speak like a professional, perceptive human assistant.

Rules:
1. Preserve conversational continuity smoothly.
2. If the user speaks English, respond in English. If Hindi, respond in Hindi. If Hinglish/code-switching, preserve the natural style.
3. Use contextual recall only when it adds natural value to the flow.
4. Use knowledge graph context for long-running projects, collaborators, decisions, reminders, and unresolved dependencies without explicitly stating "I remember" or "I see in my memory" - seamlessly incorporate it.
5. Provide proactive nudges gently.
`.trim();

function formatReminders(reminders: ReminderTask[]): string {
  // Only include pending, scheduled, or triggered reminders
  const activeReminders = reminders.filter(
    r => r.state === 'pending' || r.state === 'scheduled' || r.state === 'triggered'
  ).slice(0, 8);
  
  if (activeReminders.length === 0) return 'No active reminders.';
  
  return activeReminders.map(r => {
    const title = r.title.length > 120 ? `${r.title.slice(0, 117).trim()}...` : r.title;
    return `- [${r.state.toUpperCase()}] ${title} (Type: ${r.type})`;
  }).join('\n');
}

function boundedUtterance(session: ConversationSessionSnapshot): string {
  const intelligence = ((session as any).conversationIntelligence || []) as Array<{
    tasks: string[];
    deadlines: string[];
    decisions: string[];
    followUps: string[];
    importantPoints: string[];
    actionItems: string[];
    meetingSummary?: string;
    assignments: Array<{ person: string; responsibility: string }>;
  }>;
  if (intelligence.length > 0) {
    return intelligence
      .slice(-6)
      .flatMap(item => [
        item.meetingSummary ? `Summary: ${item.meetingSummary}` : '',
        ...item.importantPoints,
        ...item.decisions.map(decision => `Decision: ${decision}`),
        ...item.deadlines.map(deadline => `Deadline: ${deadline}`),
        ...item.actionItems,
        ...item.followUps,
        ...item.assignments.map(assignment => `${assignment.person}: ${assignment.responsibility}`),
      ])
      .filter(Boolean)
      .join('\n')
      .slice(0, 1800)
      .trim();
  }
  const chunks = ((session as any).conversationChunks || []) as Array<{
    summary: string;
    highlights: string[];
    tasks: string[];
    reminders: string[];
  }>;
  if (chunks.length > 0) {
    return chunks
      .slice(-4)
      .map(chunk => [chunk.summary, ...chunk.highlights.slice(0, 2), ...chunk.tasks, ...chunk.reminders].filter(Boolean).join('; '))
      .join('\n')
      .slice(0, 1800)
      .trim();
  }
  return session.mergedTranscript.slice(-1800).trim();
}

export function useAIOrchestrator(): UseAIOrchestratorReturn {
  const [orchestratorState, setOrchestratorState] = useState<OrchestratorState>('idle');
  const [latestContextPayload, setLatestContextPayload] = useState<OrchestratorContext | null>(null);

  // Prevent multiple assemblies running simultaneously
  const isAssemblingRef = useRef(false);
  const lastAssemblyKeyRef = useRef<string | null>(null);

  const assembleContext = useCallback((
    session: ConversationSessionSnapshot,
    memories: ConversationMemory[],
    reminders: ReminderTask[],
    semanticExtraction: SemanticExtractionResult | null
  ) => {
    if (isAssemblingRef.current) return;
    
    // Only assemble if we have an utterance
    const currentUtterance = boundedUtterance(session);
    if (!currentUtterance) return;

    const assemblyKey = [
      session.sessionId,
      session.updatedAt,
      semanticExtraction?.type || 'none',
      memories.map(memory => `${memory.id}:${memory.updatedAt}`).join('|'),
      reminders.map(reminder => `${reminder.id}:${reminder.state}:${reminder.updatedAt}`).join('|'),
    ].join('::');
    if (lastAssemblyKeyRef.current === assemblyKey) return;

    isAssemblingRef.current = true;
    setOrchestratorState('assembling');

    try {
      // Deterministic context compression
      const knowledgeGraph = pruneKnowledgeGraphForRuntime(buildKnowledgeGraphSnapshot({
        memories,
        reminders,
        query: currentUtterance,
        limits: {
          maxContextCharacters: 760,
          maxProjects: 4,
          maxParticipants: 5,
          maxTopics: 6,
        },
      }));
      const recallPayload = buildContextualRecallPayload({
        query: currentUtterance,
        memories,
        reminders,
        semanticExtraction,
        knowledgeGraph,
      });
      const proactive = buildProactiveAssistantSnapshot({
        memories,
        reminders,
        knowledgeGraph,
        limits: {
          maxSignals: 10,
          maxPrompts: 2,
          maxContextCharacters: 520,
          maxDigestItems: 4,
        },
      });
      const continuationPayload = buildContinuationPayload({
        query: currentUtterance,
        memories,
        reminders,
        currentIntelligence: ((session as any).conversationIntelligence || []),
        maxThreads: 3,
        maxContextCharacters: 1100,
      });
      const formattedReminders = formatReminders(reminders);
      const semanticGraphContext = knowledgeGraph.contextText
        ? `Semantic graph:\n${knowledgeGraph.contextText}`
        : '';
      const boundedPrompt = assembleBoundedPromptSections([
        { id: 'contextual_recall', text: recallPayload.contextText, priority: 1 },
        {
          id: 'continuation',
          text: continuationPayload.contextText ? `Continuation:\n${continuationPayload.contextText}` : '',
          priority: 2,
        },
        { id: 'knowledge_graph', text: semanticGraphContext, priority: 3 },
        {
          id: 'proactive_assistant',
          text: proactive.contextText ? `Proactive awareness:\n${proactive.contextText}` : '',
          priority: 4,
        },
      ]);
      const contextualRecall = boundedPrompt.text;

      const synthesisPayload = buildConversationalSynthesis({
        recall: recallPayload,
        continuation: continuationPayload,
        knowledgeGraph: {
          projectTimelines: knowledgeGraph.projectTimelines.slice(0, 4),
          participants: knowledgeGraph.participants.slice(0, 5),
          recurringTopics: knowledgeGraph.recurringTopics.slice(0, 6),
          diagnostics: knowledgeGraph.diagnostics,
        },
        proactiveSignals: {
          topSignals: proactive.topSignals.slice(0, 5),
          diagnostics: proactive.diagnostics,
        },
        semanticIntent: semanticExtraction,
        currentUtterance,
      });

      const contextPayload: OrchestratorContext = {
        systemDirectives: BILINGUAL_SYSTEM_PROMPT,
        recentMemories: contextualRecall,
        activeReminders: formattedReminders,
        contextualRecall,
        continuationContext: continuationPayload.contextText,
        knowledgeGraphContext: semanticGraphContext,
        knowledgeGraph: {
          projectTimelines: knowledgeGraph.projectTimelines.slice(0, 4),
          participants: knowledgeGraph.participants.slice(0, 5),
          recurringTopics: knowledgeGraph.recurringTopics.slice(0, 6),
          diagnostics: knowledgeGraph.diagnostics,
        },
        proactiveContext: proactive.contextText,
        proactiveDigest: proactive.dailyDigest,
        proactiveSignals: {
          topSignals: proactive.topSignals.slice(0, 5),
          diagnostics: proactive.diagnostics,
        },
        recallDiagnostics: recallPayload.diagnostics,
        semanticIntent: semanticExtraction,
        currentUtterance,
        bilingualContext: {
          localeHints: session.localeHints,
        },
        localSynthesis: synthesisPayload.synthesisText,
      };

      lastAssemblyKeyRef.current = assemblyKey;
      setLatestContextPayload(contextPayload);
      setOrchestratorState('ready');
    } catch (error) {
      if (__DEV__) {
        console.error('[AIOrchestrator] Failed to assemble context', error);
      }
      setOrchestratorState('idle');
    } finally {
      isAssemblingRef.current = false;
    }
  }, []);

  const resetOrchestrator = useCallback(() => {
    setOrchestratorState('idle');
    setLatestContextPayload(null);
    isAssemblingRef.current = false;
    lastAssemblyKeyRef.current = null;
  }, []);

  return {
    orchestratorState,
    latestContextPayload,
    assembleContext,
    resetOrchestrator,
  };
}
