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
  private activeHighlightTimer: number | null = null;
  readonly isSupported =
    typeof Highlight !== "undefined" &&
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof CSS.highlights?.set === "function";

  constructor() {
    if (this.isSupported) {
      injectHighlightStyles();
    }
  }

  clear(): void {
    this.noteAnchors.clear();

    if (!this.isSupported) {
      return;
    }

    CSS.highlights.delete(PRIMARY_HIGHLIGHT_NAME);
    CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
  }

  replaceAll(anchors: Iterable<LiveAnchor>): void {
    this.noteAnchors.clear();

    for (const anchor of anchors) {
      this.noteAnchors.set(anchor.noteId, anchor);
    }

    this.renderPersistentHighlight();
  }

  upsert(anchor: LiveAnchor): void {
    this.noteAnchors.set(anchor.noteId, anchor);
    this.renderPersistentHighlight();
  }

  private renderPersistentHighlight(): void {
    if (!this.isSupported) {
      return;
    }

    const persistentHighlight = new Highlight(
      ...[...this.noteAnchors.values()].map((item) => item.range.cloneRange())
    );
    persistentHighlight.priority = 1;
    CSS.highlights.set(PRIMARY_HIGHLIGHT_NAME, persistentHighlight);
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
