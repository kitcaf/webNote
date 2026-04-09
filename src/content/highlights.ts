import {
  ACTIVE_HIGHLIGHT_DURATION_MS,
  ACTIVE_HIGHLIGHT_NAME,
  HIGHLIGHT_STYLE_ID,
  PRIMARY_HIGHLIGHT_NAME
} from "../shared/constants";
import type { LiveAnchor } from "../shared/types";

const injectHighlightStyles = (): void => {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) {
    return;
  }

  const styleElement = document.createElement("style");
  styleElement.id = HIGHLIGHT_STYLE_ID;
  styleElement.textContent = `
    ::highlight(${PRIMARY_HIGHLIGHT_NAME}) {
      background: rgba(255, 208, 78, 0.36);
      color: inherit;
    }

    ::highlight(${ACTIVE_HIGHLIGHT_NAME}) {
      background: rgba(99, 102, 241, 0.32);
      color: inherit;
    }
  `;

  document.head.append(styleElement);
};

export class HighlightController {
  private readonly noteAnchors = new Map<string, LiveAnchor>();
  private readonly persistentRanges = new Map<string, Range>();
  private readonly persistentHighlight: Highlight | null;
  private activeHighlightTimer: number | null = null;
  readonly isSupported =
    typeof Highlight !== "undefined" &&
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof CSS.highlights?.set === "function";

  constructor() {
    if (this.isSupported) {
      injectHighlightStyles();
      this.persistentHighlight = new Highlight();
      this.persistentHighlight.priority = 1;
      CSS.highlights.set(PRIMARY_HIGHLIGHT_NAME, this.persistentHighlight);
    } else {
      this.persistentHighlight = null;
    }
  }

  clear(): void {
    this.noteAnchors.clear();
    this.persistentRanges.clear();

    if (!this.isSupported) {
      return;
    }

    this.persistentHighlight?.clear();
    if (this.persistentHighlight) {
      CSS.highlights.set(PRIMARY_HIGHLIGHT_NAME, this.persistentHighlight);
    }
    CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
  }

  replaceAll(anchors: Iterable<LiveAnchor>): void {
    const nextAnchors = new Map<string, LiveAnchor>();

    for (const anchor of anchors) {
      nextAnchors.set(anchor.noteId, anchor);
    }

    for (const noteId of this.noteAnchors.keys()) {
      if (!nextAnchors.has(noteId)) {
        this.remove(noteId);
      }
    }

    for (const anchor of nextAnchors.values()) {
      this.upsert(anchor);
    }
  }

  upsert(anchor: LiveAnchor): void {
    this.noteAnchors.set(anchor.noteId, anchor);

    if (!this.isSupported) {
      return;
    }

    const previousRange = this.persistentRanges.get(anchor.noteId);

    if (previousRange) {
      this.persistentHighlight?.delete(previousRange);
    }

    const nextRange = anchor.range.cloneRange();
    this.persistentRanges.set(anchor.noteId, nextRange);
    this.persistentHighlight?.add(nextRange);
  }

  remove(noteId: string): void {
    this.noteAnchors.delete(noteId);

    if (!this.isSupported) {
      return;
    }

    const previousRange = this.persistentRanges.get(noteId);

    if (!previousRange) {
      return;
    }

    this.persistentRanges.delete(noteId);
    this.persistentHighlight?.delete(previousRange);
  }

  flash(anchor: LiveAnchor): void {
    if (!this.isSupported) {
      return;
    }

    if (this.activeHighlightTimer !== null) {
      window.clearTimeout(this.activeHighlightTimer);
    }

    const activeHighlight = new Highlight(anchor.range.cloneRange());
    activeHighlight.priority = 2;
    CSS.highlights.set(ACTIVE_HIGHLIGHT_NAME, activeHighlight);

    this.activeHighlightTimer = window.setTimeout(() => {
      CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
      this.activeHighlightTimer = null;
    }, ACTIVE_HIGHLIGHT_DURATION_MS);
  }
}
