import type { LiveAnchor } from "../shared/types";
import { refreshLiveAnchorGeometry } from "./anchoring";

interface HighlightRectRecord {
  noteId: string;
  rect: DOMRect;
}

const isPointWithinRect = (x: number, y: number, rect: DOMRect): boolean =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

export class HighlightHitIndex {
  private readonly highlightAnchors = new Map<string, LiveAnchor>();
  private rectIndex: HighlightRectRecord[] = [];
  private dirty = true;
  private readonly handleGeometryChange = (): void => {
    this.dirty = true;
  };

  constructor() {
    document.addEventListener("scroll", this.handleGeometryChange, true);
    window.addEventListener("resize", this.handleGeometryChange);
  }

  dispose(): void {
    document.removeEventListener("scroll", this.handleGeometryChange, true);
    window.removeEventListener("resize", this.handleGeometryChange);
  }

  clear(): void {
    this.highlightAnchors.clear();
    this.rectIndex = [];
    this.dirty = false;
  }

  replaceAll(anchors: Iterable<LiveAnchor>): void {
    this.highlightAnchors.clear();

    for (const anchor of anchors) {
      this.highlightAnchors.set(anchor.noteId, anchor);
    }

    this.dirty = true;
  }

  upsert(anchor: LiveAnchor): void {
    this.highlightAnchors.set(anchor.noteId, anchor);
    this.dirty = true;
  }

  remove(noteId: string): void {
    if (this.highlightAnchors.delete(noteId)) {
      this.dirty = true;
    }
  }

  findNoteIdAtPoint(clientX: number, clientY: number): string | null {
    this.ensureRectIndex();
    const matchedRect = this.rectIndex.find((item) => isPointWithinRect(clientX, clientY, item.rect));
    return matchedRect?.noteId ?? null;
  }

  private ensureRectIndex(): void {
    if (!this.dirty) {
      return;
    }

    const nextRectIndex: HighlightRectRecord[] = [];

    for (const anchor of this.highlightAnchors.values()) {
      refreshLiveAnchorGeometry(anchor);

      for (const rect of anchor.rects) {
        nextRectIndex.push({
          noteId: anchor.noteId,
          rect
        });
      }
    }

    this.rectIndex = nextRectIndex;
    this.dirty = false;
  }
}
