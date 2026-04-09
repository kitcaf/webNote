import type { BasicResponse, RuntimeMessage } from "../shared/protocol";
import { AnnotationController } from "./annotation-controller";
import { ModeController } from "./mode-controller";
import { NoteController } from "./note-controller";
import { PageLifecycleCoordinator } from "./page-lifecycle";
import { PageToolbar } from "./page-toolbar";
import { watchUrlChanges } from "./url-watch";

const pageRoot = document.body;

if (!pageRoot) {
  throw new Error("WebNote requires document.body to be available.");
}

let modeController: ModeController;
let pageLifecycleCoordinator: PageLifecycleCoordinator;

const annotationController = new AnnotationController();
const pageToolbar = new PageToolbar({
  onModeChange: (mode) => {
    modeController.setMode(mode);
  },
  onOpenSidePanel: async () => {
    noteController.clearBrowserSelection();
    annotationController.cancelDraft();

    await chrome.runtime.sendMessage({
      type: "content/open-side-panel"
    } satisfies RuntimeMessage);
  }
});
const noteController = new NoteController({
  getCurrentPage: () => pageLifecycleCoordinator.getCurrentPage(),
  pageRoot
});

const isOverlayTarget = (target: EventTarget | null): boolean =>
  annotationController.isOwnedTarget(target) || pageToolbar.isOwnedTarget(target);

modeController = new ModeController({
  onModeChange: (mode) => {
    pageToolbar.setMode(mode);
    annotationController.setInteractive(mode === "annotation");

    if (mode !== "annotation") {
      annotationController.cancelDraft();
    }

    noteController.clearBrowserSelection();
  }
});

pageLifecycleCoordinator = new PageLifecycleCoordinator({
  pageRoot,
  onPageChange: (page) => {
    annotationController.setPageKey(page.key);
    noteController.hydrate(null);
    annotationController.hydrate(null);
  },
  onPageStateReady: (pageState) => {
    noteController.hydrate(pageState.pageRecord);
    annotationController.hydrate(pageState.pageRecord);
  }
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  switch (message.type) {
    case "content/capture-selection":
      void noteController.createFromLiveSelection({
        enqueueInsert: true,
        kind: "excerpt",
        openSidePanel: true
      }).then(sendResponse);
      return true;

    case "content/activate-note":
      if (message.payload.pageKey !== pageLifecycleCoordinator.getCurrentPage().key) {
        sendResponse({
          ok: false,
          reason: "The page has changed and the note belongs to a different URL."
        } satisfies BasicResponse);
        return false;
      }

      void noteController.activateNote(message.payload.noteId).then(sendResponse);
      return true;

    default:
      return false;
  }
});

document.addEventListener(
  "mouseup",
  (event) => {
    if (modeController.getMode() !== "highlight" || isOverlayTarget(event.target)) {
      return;
    }

    noteController.queueHighlightCapture();
  },
  true
);

document.addEventListener(
  "pointerdown",
  (event) => {
    if (modeController.getMode() !== "annotation" || isOverlayTarget(event.target) || event.button !== 0) {
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

    if (modeController.getMode() === "highlight" && !isOverlayTarget(event.target)) {
      const highlightNote = noteController.findHighlightNoteAtPoint(event.clientX, event.clientY);

      if (highlightNote) {
        event.preventDefault();
        event.stopPropagation();
        void noteController.deleteHighlight(highlightNote.id).catch((error) => {
          console.error("WebNote failed to delete the highlight.", error);
        });
        return;
      }
    }

    if (modeController.getMode() !== "annotation" || isOverlayTarget(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    annotationController.openDraftAt(event.pageX, event.pageY);
  },
  true
);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  annotationController.cancelDraft();
  modeController.clear();
});

watchUrlChanges(() => {
  modeController.clear();
  void pageLifecycleCoordinator.sync("content/page-changed");
});

window.addEventListener("pagehide", () => {
  pageLifecycleCoordinator.dispose();
  noteController.dispose();
  void annotationController.flushDraft();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void annotationController.flushDraft();
  }
});

void pageLifecycleCoordinator.sync("content/page-ready");
