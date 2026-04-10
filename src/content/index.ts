import type { BasicResponse, RuntimeMessage } from "../shared/protocol";
import { AnnotationController } from "./annotation-controller";
import { NoteController } from "./note-controller";
import { PageLifecycleCoordinator } from "./page-lifecycle";
import { PageToolController } from "./page-tool-controller";
import {
  loadPageToolColorPreferences,
  persistPageToolColorPreference
} from "./page-tool-preferences";
import { PageToolbar } from "./page-toolbar";
import type { PageToolState } from "./page-tools";
import { watchUrlChanges } from "./url-watch";

const pageRoot = document.body;

if (!pageRoot) {
  throw new Error("WebNote requires document.body to be available.");
}

let pageLifecycleCoordinator: PageLifecycleCoordinator;
let pageToolController: PageToolController;

const annotationController = new AnnotationController();
const noteController = new NoteController({
  getCurrentPage: () => pageLifecycleCoordinator.getCurrentPage(),
  pageRoot
});
const pageToolbar = new PageToolbar({
  onColorSelect: (mode, colorToken) => {
    pageToolController.setColor(mode, colorToken);
    persistPageToolColorPreference(mode, colorToken);
  },
  onModeSelect: (mode) => {
    pageToolController.toggleMode(mode);
  }
});

const isOverlayTarget = (target: EventTarget | null): boolean =>
  annotationController.isOwnedTarget(target) || pageToolbar.isOwnedTarget(target);

const applyToolState = (toolState: PageToolState): void => {
  pageToolbar.setState(toolState);
  noteController.setPreferredHighlightColor(toolState.highlightColor);
  annotationController.setColorToken(toolState.annotationColor);

  annotationController.setInteractive(toolState.mode === "annotation");

  if (toolState.mode !== "annotation") {
    annotationController.cancelDraft();
  }

  noteController.clearBrowserSelection();
};

pageToolController = new PageToolController({
  onStateChange: (toolState) => {
    applyToolState(toolState);
  }
});

applyToolState(pageToolController.getState());

void loadPageToolColorPreferences().then((preferences) => {
  pageToolController.hydrateColors(preferences);
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
        kind: "excerpt"
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
    if (pageToolController.getMode() !== "highlight" || isOverlayTarget(event.target)) {
      return;
    }

    noteController.queueHighlightCapture();
  },
  true
);

document.addEventListener(
  "pointerdown",
  (event) => {
    if (
      pageToolController.getMode() !== "annotation" ||
      isOverlayTarget(event.target) ||
      event.button !== 0
    ) {
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

    if (pageToolController.getMode() === "highlight" && !isOverlayTarget(event.target)) {
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

    if (pageToolController.getMode() !== "annotation" || isOverlayTarget(event.target)) {
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
  pageToolController.clear();
});

watchUrlChanges(() => {
  pageToolController.clear();
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
