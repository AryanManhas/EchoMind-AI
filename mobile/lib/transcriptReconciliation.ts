const DEFAULT_MAX_SEGMENTS = 24;
const DEFAULT_MAX_CHARS = 1800;
const DEFAULT_MAX_OVERLAP_WORDS = 16;

export type TranscriptReconciliationResult = {
  segments: string[];
  addedText: string;
  changed: boolean;
  mergedText: string;
};

export type TranscriptBufferOptions = {
  maxSegments?: number;
  maxChars?: number;
  maxOverlapWords?: number;
};

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function words(text: string): string[] {
  return compact(text).split(' ').filter(Boolean);
}

function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function normalizeText(text: string): string {
  return words(text).map(normalizeToken).filter(Boolean).join(' ');
}

export function collapseAdjacentDuplicateWords(text: string): string {
  const output: string[] = [];
  for (const token of words(text)) {
    const previous = output[output.length - 1];
    if (previous && normalizeToken(previous) === normalizeToken(token)) continue;
    output.push(token);
  }
  return output.join(' ');
}

function suffixPrefixOverlap(existing: string, incoming: string, maxOverlapWords: number): number {
  const existingWords = words(existing);
  const incomingWords = words(incoming);
  const maxOverlap = Math.min(existingWords.length, incomingWords.length, maxOverlapWords);

  for (let size = maxOverlap; size > 0; size -= 1) {
    const existingSuffix = existingWords.slice(existingWords.length - size).map(normalizeToken).join(' ');
    const incomingPrefix = incomingWords.slice(0, size).map(normalizeToken).join(' ');
    if (existingSuffix && existingSuffix === incomingPrefix) {
      return size;
    }
  }

  return 0;
}

function tailAfterPrefix(text: string, prefix: string): string {
  const textWords = words(text);
  const prefixWords = words(prefix);
  return textWords.slice(prefixWords.length).join(' ');
}

export function boundTranscriptSegments(
  segments: string[],
  options: TranscriptBufferOptions = {}
): string[] {
  const maxSegments = options.maxSegments || DEFAULT_MAX_SEGMENTS;
  const maxChars = options.maxChars || DEFAULT_MAX_CHARS;
  let bounded = segments.map(segment => compact(segment)).filter(Boolean).slice(-maxSegments);

  while (bounded.length > 1 && bounded.join(' ').length > maxChars) {
    bounded = bounded.slice(1);
  }

  if (bounded.length === 1 && bounded[0].length > maxChars) {
    bounded[0] = compact(bounded[0].slice(Math.max(0, bounded[0].length - maxChars)));
  }

  return bounded;
}

export function reconcileTranscriptSegment(
  currentSegments: string[],
  incomingText: string,
  options: TranscriptBufferOptions = {}
): TranscriptReconciliationResult {
  const incoming = collapseAdjacentDuplicateWords(compact(incomingText));
  const segments = boundTranscriptSegments(currentSegments, options);

  if (!incoming) {
    return {
      segments,
      addedText: '',
      changed: false,
      mergedText: segments.join(' '),
    };
  }

  if (segments.length === 0) {
    const nextSegments = boundTranscriptSegments([incoming], options);
    return {
      segments: nextSegments,
      addedText: incoming,
      changed: true,
      mergedText: nextSegments.join(' '),
    };
  }

  const existingFull = segments.join(' ');
  const normalizedExisting = normalizeText(existingFull);
  const normalizedIncoming = normalizeText(incoming);

  if (
    normalizedExisting === normalizedIncoming ||
    normalizedExisting.endsWith(normalizedIncoming)
  ) {
    return {
      segments,
      addedText: '',
      changed: false,
      mergedText: existingFull,
    };
  }

  if (normalizedIncoming.startsWith(normalizedExisting)) {
    const addedText = tailAfterPrefix(incoming, existingFull);
    const nextSegments = boundTranscriptSegments([...segments, addedText].filter(Boolean), options);
    return {
      segments: nextSegments,
      addedText,
      changed: !!addedText,
      mergedText: nextSegments.join(' '),
    };
  }

  const last = segments[segments.length - 1];
  const normalizedLast = normalizeText(last);

  if (normalizedIncoming.startsWith(normalizedLast)) {
    const addedText = tailAfterPrefix(incoming, last);
    const nextSegments = boundTranscriptSegments(
      [...segments.slice(0, -1), incoming],
      options
    );
    return {
      segments: nextSegments,
      addedText,
      changed: true,
      mergedText: nextSegments.join(' '),
    };
  }

  const overlap = suffixPrefixOverlap(
    last,
    incoming,
    options.maxOverlapWords || DEFAULT_MAX_OVERLAP_WORDS
  );
  if (overlap > 0) {
    const incomingWords = words(incoming);
    const addedWords = incomingWords.slice(overlap).join(' ');
    const mergedLast = collapseAdjacentDuplicateWords(`${last} ${addedWords}`);
    const nextSegments = boundTranscriptSegments(
      [...segments.slice(0, -1), mergedLast],
      options
    );
    return {
      segments: nextSegments,
      addedText: addedWords,
      changed: true,
      mergedText: nextSegments.join(' '),
    };
  }

  const nextSegments = boundTranscriptSegments([...segments, incoming], options);
  return {
    segments: nextSegments,
    addedText: incoming,
    changed: true,
    mergedText: nextSegments.join(' '),
  };
}

export function buildDisplayTranscript(
  committedSegments: string[],
  activePartialTranscript: string,
  options: TranscriptBufferOptions = {}
): string {
  const committed = boundTranscriptSegments(committedSegments, options);
  const partial = collapseAdjacentDuplicateWords(compact(activePartialTranscript));
  if (!partial) return collapseAdjacentDuplicateWords(committed.join(' '));

  const reconciled = reconcileTranscriptSegment(committed, partial, options).mergedText;
  return collapseAdjacentDuplicateWords(reconciled);
}
