import type { LiveAnchor, SerializedSelector } from "../shared/types";
import { buildTextIndex, offsetsToRange, type TextIndex } from "./dom-text";

const normalizeForComparison = (value: string): string => value.replace(/\s+/g, " ").trim();
const cloneRect = (rect: DOMRect | DOMRectReadOnly): DOMRect =>
  new DOMRect(rect.x, rect.y, rect.width, rect.height);

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
      this.isDirty = false;
    }

    return this.cachedIndex;
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

  resolve(noteId: string, selector: SerializedSelector, preferredRange?: Range): LiveAnchor | null {
    if (preferredRange && this.isRangeUsable(preferredRange)) {
      return createLiveAnchor(noteId, preferredRange.cloneRange(), "live");
    }

    return this.resolveByPosition(noteId, selector) ?? this.resolveByQuote(noteId, selector);
  }
}
