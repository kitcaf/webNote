import type { BasicResponse, RuntimeMessage } from "../shared/protocol";
import { AnnotationController } from "./annotation-controller";
import { ModeController } from "./mode-controller";
import { NoteController } from "./note-controller";
import { PageSyncController } from "./page-sync";
import { PageToolbar } from "./page-toolbar";
import { watchUrlChanges } from "./url-watch";

const pageRoot = document.body;

if (!pageRoot) {
  throw new Error("WebNote requires document.body to be available.");
}

let modeController: ModeController;
let pageSyncController: PageSyncController;

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
  getCurrentPage: () => pageSyncController.getCurrentPage(),
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

pageSyncController = new PageSyncController({
  onPageChange: (page) => {
    annotationController.setPageKey(page.key);
  },
  onPageRecord: (pageRecord) => {
    noteController.hydrate(pageRecord);
    annotationController.hydrate(pageRecord);
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
      if (message.payload.pageKey !== pageSyncController.getCurrentPage().key) {
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
  void pageSyncController.sync("content/page-changed");
});

window.addEventListener("unload", () => {
  noteController.dispose();
});

void pageSyncController.sync("content/page-ready");
