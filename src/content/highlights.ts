import {
  ACTIVE_HIGHLIGHT_DURATION_MS,
  APP_NAMESPACE,
  HIGHLIGHT_STYLE_ID,
} from "../shared/constants";
import { COLOR_TOKENS, getColorPaletteEntry, type ColorToken } from "../shared/colors";
import type { LiveAnchor } from "../shared/types";

interface HighlightEntry {
  anchor: LiveAnchor;
  colorToken: ColorToken;
}

const getPersistentHighlightName = (colorToken: ColorToken): string =>
  `${APP_NAMESPACE}-notes-${colorToken}`;

const getActiveHighlightName = (colorToken: ColorToken): string =>
  `${APP_NAMESPACE}-active-${colorToken}`;

const injectHighlightStyles = (): void => {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) {
    return;
  }

  const styleElement = document.createElement("style");
  styleElement.id = HIGHLIGHT_STYLE_ID;
  styleElement.textContent = COLOR_TOKENS.map((colorToken) => {
    const paletteEntry = getColorPaletteEntry(colorToken);

    return `
      ::highlight(${getPersistentHighlightName(colorToken)}) {
        background: ${paletteEntry.highlight.fill};
        color: inherit;
      }

      ::highlight(${getActiveHighlightName(colorToken)}) {
        background: ${paletteEntry.highlight.activeFill};
        color: inherit;
      }
    `;
  }).join("\n");

  document.head.append(styleElement);
};

export class HighlightController {
  private readonly noteAnchors = new Map<string, HighlightEntry>();
  private readonly persistentRanges = new Map<string, Range>();
  private readonly persistentHighlights = new Map<ColorToken, Highlight>();
  private activeHighlightTimer: number | null = null;
  readonly isSupported =
    typeof Highlight !== "undefined" &&
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof CSS.highlights?.set === "function";

  constructor() {
    if (this.isSupported) {
      injectHighlightStyles();

      for (const colorToken of COLOR_TOKENS) {
        const persistentHighlight = new Highlight();
        persistentHighlight.priority = 1;
        this.persistentHighlights.set(colorToken, persistentHighlight);
        CSS.highlights.set(getPersistentHighlightName(colorToken), persistentHighlight);
      }
    }
  }

  clear(): void {
    this.noteAnchors.clear();
    this.persistentRanges.clear();

    if (this.activeHighlightTimer !== null) {
      window.clearTimeout(this.activeHighlightTimer);
      this.activeHighlightTimer = null;
    }

    if (!this.isSupported) {
      return;
    }

    for (const colorToken of COLOR_TOKENS) {
      const persistentHighlight = this.persistentHighlights.get(colorToken);
      persistentHighlight?.clear();

      if (persistentHighlight) {
        CSS.highlights.set(getPersistentHighlightName(colorToken), persistentHighlight);
      }

      CSS.highlights.delete(getActiveHighlightName(colorToken));
    }
  }

  replaceAll(entries: Iterable<HighlightEntry>): void {
    const nextAnchors = new Map<string, HighlightEntry>();

    for (const entry of entries) {
      nextAnchors.set(entry.anchor.noteId, entry);
    }

    for (const noteId of this.noteAnchors.keys()) {
      if (!nextAnchors.has(noteId)) {
        this.remove(noteId);
      }
    }

    for (const entry of nextAnchors.values()) {
      this.upsert(entry.anchor, entry.colorToken);
    }
  }

  upsert(anchor: LiveAnchor, colorToken: ColorToken): void {
    const previousEntry = this.noteAnchors.get(anchor.noteId);
    this.noteAnchors.set(anchor.noteId, {
      anchor,
      colorToken
    });

    if (!this.isSupported) {
      return;
    }

    const previousRange = this.persistentRanges.get(anchor.noteId);

    if (previousRange) {
      const previousColorToken = previousEntry?.colorToken ?? colorToken;
      this.persistentHighlights.get(previousColorToken)?.delete(previousRange);
    }

    const nextRange = anchor.range.cloneRange();
    this.persistentRanges.set(anchor.noteId, nextRange);
    this.persistentHighlights.get(colorToken)?.add(nextRange);
  }

  remove(noteId: string): void {
    const previousEntry = this.noteAnchors.get(noteId);
    this.noteAnchors.delete(noteId);

    if (!this.isSupported) {
      return;
    }

    const previousRange = this.persistentRanges.get(noteId);

    if (!previousRange) {
      return;
    }

    this.persistentRanges.delete(noteId);
    if (previousEntry) {
      this.persistentHighlights.get(previousEntry.colorToken)?.delete(previousRange);
    }
  }

  flash(anchor: LiveAnchor, colorToken: ColorToken): void {
    if (!this.isSupported) {
      return;
    }

    if (this.activeHighlightTimer !== null) {
      window.clearTimeout(this.activeHighlightTimer);
    }

    for (const activeColorToken of COLOR_TOKENS) {
      CSS.highlights.delete(getActiveHighlightName(activeColorToken));
    }

    const activeHighlight = new Highlight(anchor.range.cloneRange());
    activeHighlight.priority = 2;
    const activeHighlightName = getActiveHighlightName(colorToken);
    CSS.highlights.set(activeHighlightName, activeHighlight);

    this.activeHighlightTimer = window.setTimeout(() => {
      CSS.highlights.delete(activeHighlightName);
      this.activeHighlightTimer = null;
    }, ACTIVE_HIGHLIGHT_DURATION_MS);
  }
}
