import type { BasicResponse, PageRecordResponse, RuntimeMessage } from "../shared/protocol";
import {
  createNoteEntity,
  createPageDescriptor,
  createWebAnnotationEntity
} from "../shared/serialization";
import type {
  LiveAnchor,
  NoteEntity,
  NoteKind,
  PageDescriptor,
  PageRecord,
  WebAnnotationEntity
} from "../shared/types";
import { AnchorEngine } from "./anchoring";
import { AnnotationOverlay } from "./annotation-overlay";
import { HighlightController } from "./highlights";
import { PageToolbar, type PageToolMode } from "./page-toolbar";
import { captureSelection } from "./selection";
import { watchUrlChanges } from "./url-watch";

const pageRoot = document.body;

if (!pageRoot) {
  throw new Error("WebNote requires document.body to be available.");
}

const anchorEngine = new AnchorEngine(pageRoot);
const annotationOverlay = new AnnotationOverlay({
  onDelete: async (annotationId) => {
    await deleteAnnotation(annotationId);
  },
  onSave: async (input) => {
    return saveAnnotation(input);
  }
});
const highlightController = new HighlightController();
const pageToolbar = new PageToolbar({
  onModeChange: (mode) => {
    setActiveToolMode(mode);
  },
  onOpenSidePanel: async () => {
    clearBrowserSelection();
    annotationOverlay.cancelDraft();

    await chrome.runtime.sendMessage({
      type: "content/open-side-panel"
    } satisfies RuntimeMessage);
  }
});
const noteEntities = new Map<string, NoteEntity>();
const liveAnchors = new Map<string, LiveAnchor>();
const webAnnotations = new Map<string, WebAnnotationEntity>();
let activeToolMode: PageToolMode = null;
let currentPage: PageDescriptor = createPageDescriptor(window.location.href, document.title);
let isHighlightCaptureQueued = false;

const isOverlayTarget = (target: EventTarget | null): boolean =>
  annotationOverlay.isOwnedTarget(target) || pageToolbar.isOwnedTarget(target);

const clearBrowserSelection = (): void => {
  window.getSelection()?.removeAllRanges();
};

const setActiveToolMode = (mode: PageToolMode): void => {
  activeToolMode = mode;
  pageToolbar.setMode(mode);
  annotationOverlay.setInteractive(mode === "annotation");

  if (mode !== "annotation") {
    annotationOverlay.cancelDraft();
  }

  clearBrowserSelection();
};

const renderAnnotations = (): void => {
  annotationOverlay.hydrate([...webAnnotations.values()]);
};

const isPointWithinRect = (x: number, y: number, rect: DOMRect): boolean =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

const findHighlightNoteAtPoint = (clientX: number, clientY: number): NoteEntity | null => {
  for (const [noteId, liveAnchor] of liveAnchors.entries()) {
    const noteEntity = noteEntities.get(noteId);

    if (!noteEntity || noteEntity.kind !== "highlight") {
      continue;
    }

    const clientRects = [...liveAnchor.range.getClientRects()];
    const isMatch = clientRects.some((rect) => isPointWithinRect(clientX, clientY, rect));

    if (isMatch) {
      return noteEntity;
    }
  }

  return null;
};

const scrollRangeIntoView = (range: Range): void => {
  const rect = range.getBoundingClientRect();
  const top = window.scrollY + rect.top - window.innerHeight * 0.25;
  window.scrollTo({
    behavior: "smooth",
    top: Math.max(0, top)
  });
};

const hydratePage = (pageRecord: PageRecord | null): void => {
  noteEntities.clear();
  liveAnchors.clear();
  webAnnotations.clear();
  highlightController.clear();

  if (!pageRecord) {
    renderAnnotations();
    return;
  }

  for (const annotation of pageRecord.annotations) {
    webAnnotations.set(annotation.id, annotation);
  }

  for (const note of pageRecord.notes) {
    noteEntities.set(note.id, note);
    const liveAnchor = anchorEngine.resolve(note.id, note.selectors);

    if (!liveAnchor) {
      continue;
    }

    liveAnchors.set(note.id, liveAnchor);
    highlightController.upsert(liveAnchor);
  }

  renderAnnotations();
};

const syncPage = async (type: "content/page-ready" | "content/page-changed"): Promise<void> => {
  currentPage = createPageDescriptor(window.location.href, document.title);
  annotationOverlay.setPageKey(currentPage.key);

  const response = (await chrome.runtime.sendMessage({
    type,
    payload: {
      page: currentPage
    }
  } satisfies RuntimeMessage)) as PageRecordResponse;

  if (!response.ok) {
    console.error("Failed to load the page record.", response.reason);
    return;
  }

  hydratePage(response.pageRecord);
};

const createNoteFromLiveSelection = async (options: {
  enqueueInsert: boolean;
  kind: NoteKind;
  openSidePanel: boolean;
}): Promise<BasicResponse> => {
  const capturedSelection = captureSelection(pageRoot);

  if (!capturedSelection) {
    return {
      ok: false,
      reason: "No active text selection was found."
    };
  }

  const noteEntity = createNoteEntity({
    kind: options.kind,
    page: currentPage,
    quoteText: capturedSelection.quoteText,
    selectors: capturedSelection.selectors
  });
  const liveAnchor: LiveAnchor = {
    noteId: noteEntity.id,
    range: capturedSelection.range.cloneRange(),
    rect: capturedSelection.range.getBoundingClientRect(),
    source: "live"
  };

  noteEntities.set(noteEntity.id, noteEntity);
  liveAnchors.set(noteEntity.id, liveAnchor);
  highlightController.upsert(liveAnchor);

  const response = (await chrome.runtime.sendMessage({
    type: "content/create-note",
    payload: {
      note: noteEntity,
      options
    }
  } satisfies RuntimeMessage)) as BasicResponse;

  if (!response.ok) {
    noteEntities.delete(noteEntity.id);
    liveAnchors.delete(noteEntity.id);
    highlightController.clear();

    for (const anchor of liveAnchors.values()) {
      highlightController.upsert(anchor);
    }

    return response;
  }

  clearBrowserSelection();
  return response;
};

const queueHighlightCapture = (): void => {
  if (isHighlightCaptureQueued) {
    return;
  }

  isHighlightCaptureQueued = true;
  window.requestAnimationFrame(() => {
    isHighlightCaptureQueued = false;

    if (activeToolMode !== "highlight") {
      return;
    }

    void createNoteFromLiveSelection({
      enqueueInsert: false,
      kind: "highlight",
      openSidePanel: false
    }).then((response) => {
      if (!response.ok && response.reason !== "No active text selection was found.") {
        console.error("WebNote failed to create a highlight.", response.reason);
      }
    });
  });
};

const saveAnnotation = async (input: {
  annotationId?: string;
  content: string;
  pageKey: string;
  x: number;
  y: number;
}): Promise<WebAnnotationEntity> => {
  const existingAnnotation = input.annotationId ? webAnnotations.get(input.annotationId) ?? null : null;
  const nextAnnotation = existingAnnotation
    ? {
        ...existingAnnotation,
        content: input.content.trim(),
        x: Math.round(input.x),
        y: Math.round(input.y),
        updatedAt: new Date().toISOString()
      }
    : createWebAnnotationEntity({
        content: input.content,
        pageKey: input.pageKey,
        x: input.x,
        y: input.y
      });

  const response = (await chrome.runtime.sendMessage({
    type: "content/upsert-annotation",
    payload: {
      annotation: nextAnnotation
    }
  } satisfies RuntimeMessage)) as BasicResponse;

  if (!response.ok) {
    throw new Error(response.reason ?? "Failed to save the web annotation.");
  }

  webAnnotations.set(nextAnnotation.id, nextAnnotation);
  return nextAnnotation;
};

const deleteHighlightNote = async (noteId: string): Promise<void> => {
  const noteEntity = noteEntities.get(noteId);
  const liveAnchor = liveAnchors.get(noteId);

  if (!noteEntity || noteEntity.kind !== "highlight") {
    return;
  }

  noteEntities.delete(noteId);
  liveAnchors.delete(noteId);
  highlightController.clear();

  for (const anchor of liveAnchors.values()) {
    highlightController.upsert(anchor);
  }

  const response = (await chrome.runtime.sendMessage({
    type: "content/delete-note",
    payload: {
      noteId,
      pageKey: currentPage.key
    }
  } satisfies RuntimeMessage)) as BasicResponse;

  if (response.ok) {
    return;
  }

  noteEntities.set(noteEntity.id, noteEntity);

  if (liveAnchor) {
    liveAnchors.set(liveAnchor.noteId, liveAnchor);
  }

  highlightController.clear();

  for (const anchor of liveAnchors.values()) {
    highlightController.upsert(anchor);
  }

  throw new Error(response.reason ?? "Failed to delete the highlight note.");
};

const deleteAnnotation = async (annotationId: string): Promise<void> => {
  if (!webAnnotations.has(annotationId)) {
    return;
  }

  const response = (await chrome.runtime.sendMessage({
    type: "content/delete-annotation",
    payload: {
      annotationId,
      pageKey: currentPage.key
    }
  } satisfies RuntimeMessage)) as BasicResponse;

  if (!response.ok) {
    throw new Error(response.reason ?? "Failed to delete the web annotation.");
  }

  webAnnotations.delete(annotationId);
};

const activateNote = async (noteId: string): Promise<BasicResponse> => {
  const noteEntity = noteEntities.get(noteId);

  if (!noteEntity) {
    return {
      ok: false,
      reason: "The requested note does not exist on this page."
    };
  }

  const preferredRange = liveAnchors.get(noteId)?.range;
  const liveAnchor = anchorEngine.resolve(noteId, noteEntity.selectors, preferredRange);

  if (!liveAnchor) {
    return {
      ok: false,
      reason: "The captured quote could not be re-anchored on the page."
    };
  }

  liveAnchors.set(noteId, liveAnchor);
  highlightController.upsert(liveAnchor);
  highlightController.flash(liveAnchor);
  scrollRangeIntoView(liveAnchor.range);
  return { ok: true };
};

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  switch (message.type) {
    case "content/capture-selection":
      void createNoteFromLiveSelection({
        enqueueInsert: true,
        kind: "excerpt",
        openSidePanel: true
      }).then(sendResponse);
      return true;

    case "content/activate-note":
      if (message.payload.pageKey !== currentPage.key) {
        sendResponse({
          ok: false,
          reason: "The page has changed and the note belongs to a different URL."
        } satisfies BasicResponse);
        return false;
      }

      void activateNote(message.payload.noteId).then(sendResponse);
      return true;

    default:
      return false;
  }
});

document.addEventListener(
  "mouseup",
  (event) => {
    if (activeToolMode !== "highlight" || isOverlayTarget(event.target)) {
      return;
    }

    queueHighlightCapture();
  },
  true
);

document.addEventListener(
  "pointerdown",
  (event) => {
    if (activeToolMode !== "annotation" || isOverlayTarget(event.target) || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  },
  true
);

document.addEventListener(
  "click",
  (event) => {
    if (!(event instanceof MouseEvent)) {
      return;
    }

    if (activeToolMode === "highlight" && !isOverlayTarget(event.target)) {
      const highlightNote = findHighlightNoteAtPoint(event.clientX, event.clientY);

      if (highlightNote) {
        event.preventDefault();
        event.stopPropagation();
        void deleteHighlightNote(highlightNote.id).catch((error) => {
          console.error("WebNote failed to delete the highlight.", error);
        });
        return;
      }
    }

    if (activeToolMode !== "annotation" || isOverlayTarget(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    annotationOverlay.openDraftAt(event.pageX, event.pageY);
  },
  true
);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  annotationOverlay.cancelDraft();
  setActiveToolMode(null);
});

watchUrlChanges(() => {
  setActiveToolMode(null);
  void syncPage("content/page-changed");
});

void syncPage("content/page-ready");
