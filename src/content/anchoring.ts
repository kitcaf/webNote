import type { LiveAnchor, SerializedSelector } from "../shared/types";
import { buildTextIndex, offsetsToRange, type TextIndex } from "./dom-text";

const normalizeForComparison = (value: string): string => value.replace(/\s+/g, " ").trim();
const cloneRect = (rect: DOMRect | DOMRectReadOnly): DOMRect =>
  new DOMRect(rect.x, rect.y, rect.width, rect.height);

interface NormalizedTextIndex {
  text: string;
  startOffsets: number[];
  endOffsets: number[];
}

export const snapshotRangeRects = (range: Range): DOMRect[] =>
  [...range.getClientRects()]
    .map((rect) => cloneRect(rect))
    .filter((rect) => rect.width > 0 || rect.height > 0);

export const refreshLiveAnchorGeometry = (anchor: LiveAnchor): LiveAnchor => {
  anchor.rect = cloneRect(anchor.range.getBoundingClientRect());
  anchor.rects = snapshotRangeRects(anchor.range);
  return anchor;
};

export const createLiveAnchor = (
  noteId: string,
  range: Range,
  source: LiveAnchor["source"]
): LiveAnchor =>
  refreshLiveAnchorGeometry({
    noteId,
    range,
    source,
    rect: null,
    rects: []
  });

const scoreContext = (text: string, selector: SerializedSelector, start: number, end: number): number => {
  let score = 0;

  if (selector.quote.prefix && text.slice(Math.max(0, start - selector.quote.prefix.length), start) === selector.quote.prefix) {
    score += selector.quote.prefix.length;
  }

  if (selector.quote.suffix && text.slice(end, end + selector.quote.suffix.length) === selector.quote.suffix) {
    score += selector.quote.suffix.length;
  }

  return score;
};

export class AnchorEngine {
  private readonly mutationObserver: MutationObserver;
  private cachedIndex: TextIndex | null = null;
  private cachedNormalizedIndex: NormalizedTextIndex | null = null;
  private isDirty = true;

  constructor(private readonly root: HTMLElement) {
    this.mutationObserver = new MutationObserver(() => {
      this.isDirty = true;
    });

    this.mutationObserver.observe(this.root, {
      characterData: true,
      childList: true,
      subtree: true
    });
  }

  disconnect(): void {
    this.mutationObserver.disconnect();
  }

  private getTextIndex(): TextIndex {
    if (!this.cachedIndex || this.isDirty) {
      this.cachedIndex = buildTextIndex(this.root);
      this.cachedNormalizedIndex = null;
      this.isDirty = false;
    }

    return this.cachedIndex;
  }

  private getNormalizedTextIndex(): NormalizedTextIndex {
    if (this.cachedNormalizedIndex) {
      return this.cachedNormalizedIndex;
    }

    const rawText = this.getTextIndex().text;
    const characters: string[] = [];
    const startOffsets: number[] = [];
    const endOffsets: number[] = [];

    for (let rawIndex = 0; rawIndex < rawText.length; rawIndex += 1) {
      const character = rawText[rawIndex];

      if (!character) {
        continue;
      }

      if (/\s/.test(character)) {
        if (characters.length === 0) {
          continue;
        }

        if (characters[characters.length - 1] === " ") {
          endOffsets[endOffsets.length - 1] = rawIndex + 1;
          continue;
        }

        characters.push(" ");
        startOffsets.push(rawIndex);
        endOffsets.push(rawIndex + 1);
        continue;
      }

      characters.push(character);
      startOffsets.push(rawIndex);
      endOffsets.push(rawIndex + 1);
    }

    if (characters[characters.length - 1] === " ") {
      characters.pop();
      startOffsets.pop();
      endOffsets.pop();
    }

    this.cachedNormalizedIndex = {
      text: characters.join(""),
      startOffsets,
      endOffsets
    };

    return this.cachedNormalizedIndex;
  }

  private isRangeUsable(range: Range): boolean {
    return (
      range.collapsed === false &&
      this.root.contains(range.commonAncestorContainer) &&
      range.toString().trim().length > 0
    );
  }

  private resolveByPosition(noteId: string, selector: SerializedSelector): LiveAnchor | null {
    const textIndex = this.getTextIndex();
    const candidateRange = offsetsToRange(textIndex, selector.position.start, selector.position.end);

    if (!candidateRange) {
      return null;
    }

    const candidateText = textIndex.text.slice(selector.position.start, selector.position.end);

    if (candidateText === selector.quote.exact) {
      return createLiveAnchor(noteId, candidateRange, "position");
    }

    if (normalizeForComparison(candidateRange.toString()) === normalizeForComparison(selector.quote.exact)) {
      return createLiveAnchor(noteId, candidateRange, "position");
    }

    return null;
  }

  private resolveByQuote(noteId: string, selector: SerializedSelector): LiveAnchor | null {
    const textIndex = this.getTextIndex();

    if (!selector.quote.exact) {
      return null;
    }

    let bestMatch: { start: number; end: number; score: number } | null = null;
    let searchOffset = 0;

    while (searchOffset < textIndex.text.length) {
      const matchOffset = textIndex.text.indexOf(selector.quote.exact, searchOffset);

      if (matchOffset < 0) {
        break;
      }

      const matchEnd = matchOffset + selector.quote.exact.length;
      const score = scoreContext(textIndex.text, selector, matchOffset, matchEnd);

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          start: matchOffset,
          end: matchEnd,
          score
        };
      }

      searchOffset = matchOffset + Math.max(selector.quote.exact.length, 1);
    }

    if (!bestMatch) {
      return null;
    }

    const candidateRange = offsetsToRange(textIndex, bestMatch.start, bestMatch.end);

    if (!candidateRange) {
      return null;
    }

    return createLiveAnchor(noteId, candidateRange, "quote");
  }

  private resolveByNormalizedQuote(
    noteId: string,
    selector: SerializedSelector,
    fallbackQuoteText?: string
  ): LiveAnchor | null {
    const normalizedQuote = normalizeForComparison(fallbackQuoteText ?? selector.quote.exact);

    if (!normalizedQuote) {
      return null;
    }

    const textIndex = this.getTextIndex();
    const normalizedIndex = this.getNormalizedTextIndex();
    const normalizedPrefix = normalizeForComparison(selector.quote.prefix);
    const normalizedSuffix = normalizeForComparison(selector.quote.suffix);
    let bestMatch: { start: number; end: number; score: number } | null = null;
    let searchOffset = 0;

    while (searchOffset < normalizedIndex.text.length) {
      const matchOffset = normalizedIndex.text.indexOf(normalizedQuote, searchOffset);

      if (matchOffset < 0) {
        break;
      }

      const matchEnd = matchOffset + normalizedQuote.length;
      let score = 0;

      if (
        normalizedPrefix &&
        normalizedIndex.text.slice(Math.max(0, matchOffset - normalizedPrefix.length), matchOffset) === normalizedPrefix
      ) {
        score += normalizedPrefix.length;
      }

      if (
        normalizedSuffix &&
        normalizedIndex.text.slice(matchEnd, matchEnd + normalizedSuffix.length) === normalizedSuffix
      ) {
        score += normalizedSuffix.length;
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          start: matchOffset,
          end: matchEnd,
          score
        };
      }

      searchOffset = matchOffset + Math.max(normalizedQuote.length, 1);
    }

    if (!bestMatch) {
      return null;
    }

    const rawStart = normalizedIndex.startOffsets[bestMatch.start];
    const rawEnd = normalizedIndex.endOffsets[bestMatch.end - 1];

    if (rawStart === undefined || rawEnd === undefined || rawEnd <= rawStart) {
      return null;
    }

    const candidateRange = offsetsToRange(textIndex, rawStart, rawEnd);

    if (!candidateRange) {
      return null;
    }

    if (normalizeForComparison(candidateRange.toString()) !== normalizedQuote) {
      return null;
    }

    return createLiveAnchor(noteId, candidateRange, "quote");
  }

  resolve(
    noteId: string,
    selector: SerializedSelector,
    preferredRange?: Range,
    fallbackQuoteText?: string
  ): LiveAnchor | null {
    if (preferredRange && this.isRangeUsable(preferredRange)) {
      return createLiveAnchor(noteId, preferredRange.cloneRange(), "live");
    }

    return (
      this.resolveByPosition(noteId, selector) ??
      this.resolveByQuote(noteId, selector) ??
      this.resolveByNormalizedQuote(noteId, selector, fallbackQuoteText)
    );
  }
}
