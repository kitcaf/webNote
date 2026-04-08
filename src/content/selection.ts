import { SELECTION_CONTEXT_CHARS } from "../shared/constants";
import type { SerializedSelector } from "../shared/types";
import { buildTextIndex, rangeToOffsets } from "./dom-text";

export interface CapturedSelection {
  quoteText: string;
  range: Range;
  selectors: SerializedSelector;
}

const normalizeSelectionText = (rawText: string): string => rawText.replace(/\s+/g, " ").trim();

export const captureSelection = (root: HTMLElement): CapturedSelection | null => {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const selectionRange = selection.getRangeAt(0).cloneRange();
  const offsets = rangeToOffsets(root, selectionRange);

  if (!offsets || offsets.end <= offsets.start) {
    return null;
  }

  const textIndex = buildTextIndex(root);
  const exactText = textIndex.text.slice(offsets.start, offsets.end);
  const quoteText = normalizeSelectionText(exactText);

  if (!quoteText) {
    return null;
  }

  return {
    quoteText,
    range: selectionRange,
    selectors: {
      position: offsets,
      quote: {
        exact: exactText,
        prefix: textIndex.text.slice(Math.max(0, offsets.start - SELECTION_CONTEXT_CHARS), offsets.start),
        suffix: textIndex.text.slice(offsets.end, offsets.end + SELECTION_CONTEXT_CHARS)
      }
    }
  };
};
