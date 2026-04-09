import type { BasicResponse, RuntimeMessage } from "../shared/protocol";
import {
  HIGHLIGHT_CAPTURE_DEBOUNCE_MS,
  HIGHLIGHT_CAPTURE_DEDUPE_WINDOW_MS
} from "../shared/constants";
import { createNoteEntity } from "../shared/serialization";
import type {
  LiveAnchor,
  NoteEntity,
  NoteKind,
  PageDescriptor,
  PageRecord
} from "../shared/types";
import { AnchorEngine, createLiveAnchor } from "./anchoring";
import { HighlightHitIndex } from "./highlight-hit-index";
import { HighlightController } from "./highlights";
import { captureSelection, type CapturedSelection } from "./selection";

interface CreateNoteOptions {
  enqueueInsert: boolean;
  kind: NoteKind;
  openSidePanel: boolean;
}

interface NoteControllerOptions {
  getCurrentPage: () => PageDescriptor;
  pageRoot: HTMLElement;
}

const scrollRangeIntoView = (range: Range): void => {
  const rect = range.getBoundingClientRect();
  const top = window.scrollY + rect.top - window.innerHeight * 0.25;
  window.scrollTo({
    behavior: "smooth",
    top: Math.max(0, top)
  });
};

export class NoteController {
  private readonly anchorEngine: AnchorEngine;
  private readonly highlightController = new HighlightController();
  private readonly highlightHitIndex = new HighlightHitIndex();
  private readonly noteEntities = new Map<string, NoteEntity>();
  private readonly liveAnchors = new Map<string, LiveAnchor>();
  private highlightCaptureTimer: number | null = null;
  private lastHighlightSelectionSignature: string | null = null;
  private lastHighlightSelectionTimestamp = 0;

  constructor(private readonly options: NoteControllerOptions) {
    this.anchorEngine = new AnchorEngine(options.pageRoot);
  }

  dispose(): void {
    if (this.highlightCaptureTimer !== null) {
      window.clearTimeout(this.highlightCaptureTimer);
      this.highlightCaptureTimer = null;
    }

    this.anchorEngine.disconnect();
    this.highlightHitIndex.dispose();
  }

  clearBrowserSelection(): void {
    window.getSelection()?.removeAllRanges();
  }

  hydrate(pageRecord: PageRecord | null): void {
    this.noteEntities.clear();
    this.liveAnchors.clear();
    this.highlightController.clear();
    this.highlightHitIndex.clear();

    if (!pageRecord) {
      return;
    }

    for (const note of pageRecord.notes) {
      this.noteEntities.set(note.id, note);
      const liveAnchor = this.anchorEngine.resolve(note.id, note.selectors, undefined, note.quoteText);

      if (!liveAnchor) {
        continue;
      }

      this.liveAnchors.set(note.id, liveAnchor);
    }

    this.refreshPresentation();
  }

  private buildSelectionSignature(capturedSelection: CapturedSelection): string {
    return [
      capturedSelection.selectors.position.start,
      capturedSelection.selectors.position.end,
      capturedSelection.quoteText
    ].join(":");
  }

  private hasMatchingHighlight(capturedSelection: CapturedSelection): boolean {
    return [...this.noteEntities.values()].some((noteEntity) => {
      if (noteEntity.kind !== "highlight") {
        return false;
      }

      return (
        noteEntity.quoteText === capturedSelection.quoteText &&
        noteEntity.selectors.position.start === capturedSelection.selectors.position.start &&
        noteEntity.selectors.position.end === capturedSelection.selectors.position.end
      );
    });
  }

  private shouldSkipHighlightCapture(capturedSelection: CapturedSelection): boolean {
    const selectionSignature = this.buildSelectionSignature(capturedSelection);

    if (this.hasMatchingHighlight(capturedSelection)) {
      return true;
    }

    return (
      this.lastHighlightSelectionSignature === selectionSignature &&
      Date.now() - this.lastHighlightSelectionTimestamp < HIGHLIGHT_CAPTURE_DEDUPE_WINDOW_MS
    );
  }

  private markHighlightCapture(selectionSignature: string): void {
    this.lastHighlightSelectionSignature = selectionSignature;
    this.lastHighlightSelectionTimestamp = Date.now();
  }

  private async createFromCapturedSelection(
    capturedSelection: CapturedSelection,
    options: CreateNoteOptions
  ): Promise<BasicResponse> {
    if (options.kind === "highlight" && this.shouldSkipHighlightCapture(capturedSelection)) {
      this.clearBrowserSelection();
      return { ok: true };
    }

    const noteEntity = createNoteEntity({
      kind: options.kind,
      page: this.options.getCurrentPage(),
      quoteText: capturedSelection.quoteText,
      selectors: capturedSelection.selectors
    });
    const liveAnchor = createLiveAnchor(noteEntity.id, capturedSelection.range.cloneRange(), "live");

    this.noteEntities.set(noteEntity.id, noteEntity);
    this.liveAnchors.set(noteEntity.id, liveAnchor);
    this.highlightController.upsert(liveAnchor);

    if (noteEntity.kind === "highlight") {
      this.highlightHitIndex.upsert(liveAnchor);
    }

    const response = (await chrome.runtime.sendMessage({
      type: "content/create-note",
      payload: {
        note: noteEntity,
        options
      }
    } satisfies RuntimeMessage)) as BasicResponse;

    if (!response.ok) {
      this.noteEntities.delete(noteEntity.id);
      this.liveAnchors.delete(noteEntity.id);

      if (noteEntity.kind === "highlight") {
        this.highlightHitIndex.remove(noteEntity.id);
      }

      this.highlightController.remove(noteEntity.id);
      return response;
    }

    if (noteEntity.kind === "highlight") {
      this.markHighlightCapture(this.buildSelectionSignature(capturedSelection));
    }

    this.clearBrowserSelection();
    return response;
  }

  async createFromLiveSelection(options: CreateNoteOptions): Promise<BasicResponse> {
    const capturedSelection = captureSelection(this.options.pageRoot);

    if (!capturedSelection) {
      return {
        ok: false,
        reason: "No active text selection was found."
      };
    }

    return this.createFromCapturedSelection(capturedSelection, options);
  }

  queueHighlightCapture(): void {
    if (this.highlightCaptureTimer !== null) {
      window.clearTimeout(this.highlightCaptureTimer);
    }

    this.highlightCaptureTimer = window.setTimeout(() => {
      this.highlightCaptureTimer = null;
      const capturedSelection = captureSelection(this.options.pageRoot);

      if (!capturedSelection) {
        return;
      }

      void this.createFromCapturedSelection(capturedSelection, {
        enqueueInsert: false,
        kind: "highlight",
        openSidePanel: false
      }).then((response) => {
        if (!response.ok && response.reason !== "No active text selection was found.") {
          console.error("WebNote failed to create a highlight.", response.reason);
        }
      });
    }, HIGHLIGHT_CAPTURE_DEBOUNCE_MS);
  }

  findHighlightNoteAtPoint(clientX: number, clientY: number): NoteEntity | null {
    const matchedNoteId = this.highlightHitIndex.findNoteIdAtPoint(clientX, clientY);

    if (!matchedNoteId) {
      return null;
    }

    const noteEntity = this.noteEntities.get(matchedNoteId);
    return noteEntity?.kind === "highlight" ? noteEntity : null;
  }

  async deleteHighlight(noteId: string): Promise<void> {
    const noteEntity = this.noteEntities.get(noteId);
    const liveAnchor = this.liveAnchors.get(noteId);

    if (!noteEntity || noteEntity.kind !== "highlight") {
      return;
    }

    this.noteEntities.delete(noteId);
    this.liveAnchors.delete(noteId);
    this.highlightController.remove(noteId);
    this.highlightHitIndex.remove(noteId);

    const response = (await chrome.runtime.sendMessage({
      type: "content/delete-note",
      payload: {
        noteId,
        pageKey: this.options.getCurrentPage().key
      }
    } satisfies RuntimeMessage)) as BasicResponse;

    if (response.ok) {
      return;
    }

    this.noteEntities.set(noteEntity.id, noteEntity);

    if (liveAnchor) {
      this.liveAnchors.set(liveAnchor.noteId, liveAnchor);
    }

    if (liveAnchor) {
      this.highlightController.upsert(liveAnchor);
      this.highlightHitIndex.upsert(liveAnchor);
    }

    throw new Error(response.reason ?? "Failed to delete the highlight note.");
  }

  async activateNote(noteId: string): Promise<BasicResponse> {
    const noteEntity = this.noteEntities.get(noteId);

    if (!noteEntity) {
      return {
        ok: false,
        reason: "The requested note does not exist on this page."
      };
    }

    const preferredRange = this.liveAnchors.get(noteId)?.range;
    const liveAnchor = this.anchorEngine.resolve(
      noteId,
      noteEntity.selectors,
      preferredRange,
      noteEntity.quoteText
    );

    if (!liveAnchor) {
      return {
        ok: false,
        reason: "The captured quote could not be re-anchored on the page."
      };
    }

    this.liveAnchors.set(noteId, liveAnchor);
    this.highlightController.upsert(liveAnchor);

    if (noteEntity.kind === "highlight") {
      this.highlightHitIndex.upsert(liveAnchor);
    }

    this.highlightController.flash(liveAnchor);
    scrollRangeIntoView(liveAnchor.range);
    return { ok: true };
  }

  private getHighlightAnchors(): LiveAnchor[] {
    const highlightAnchors: LiveAnchor[] = [];

    for (const [noteId, liveAnchor] of this.liveAnchors.entries()) {
      if (this.noteEntities.get(noteId)?.kind === "highlight") {
        highlightAnchors.push(liveAnchor);
      }
    }

    return highlightAnchors;
  }

  private refreshPresentation(): void {
    this.highlightController.replaceAll(this.liveAnchors.values());
    this.highlightHitIndex.replaceAll(this.getHighlightAnchors());
  }
}
