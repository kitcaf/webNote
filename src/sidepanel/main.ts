import "../styles/sidepanel.css";

import { DOCUMENT_SAVE_DEBOUNCE_MS, SIDEPANEL_PORT_NAME } from "../shared/constants";
import type { BasicResponse, PageRecordResponse, RuntimeMessage } from "../shared/protocol";
import type { PageKey, PageRecord, PageViewState, PendingInsert } from "../shared/types";
import { deleteCachedDraft } from "./draft-cache";
import { EditorSessionManager } from "./editor";

const editorSurface = document.getElementById("editor-surface");

if (!(editorSurface instanceof HTMLElement)) {
  throw new Error("WebNote side panel failed to find the expected shell elements.");
}

const editorSessionManager = new EditorSessionManager();
const sidePanelPort = chrome.runtime.connect({
  name: SIDEPANEL_PORT_NAME
});
let activePageRecord: PageRecord | null = null;
let saveTimer: number | null = null;
let insertedPendingNoteIds = new Set<string>();

const getCurrentDraftSnapshot = (): { markdown: string; pageKey: PageKey } | null => {
  if (!activePageRecord) {
    return null;
  }

  return {
    markdown: editorSessionManager.getMarkdown(),
    pageKey: activePageRecord.page.key
  };
};

const persistDocumentSnapshot = async (snapshot: {
  markdown: string;
  pageKey: PageKey;
}): Promise<void> => {
  const response = (await chrome.runtime.sendMessage({
    type: "panel/save-document",
    payload: {
      pageKey: snapshot.pageKey,
      markdown: snapshot.markdown
    }
  } satisfies RuntimeMessage)) as BasicResponse;

  if (!response.ok) {
    console.error("WebNote failed to save the current document.", response.reason);
  }
};

const persistDocument = async (): Promise<void> => {
  const snapshot = getCurrentDraftSnapshot();

  if (!snapshot) {
    return;
  }

  await persistDocumentSnapshot(snapshot);
};

const flushPendingDocumentSave = async (): Promise<void> => {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  await persistDocument();
};

const scheduleDocumentSave = (): void => {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }

  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void persistDocument();
  }, DOCUMENT_SAVE_DEBOUNCE_MS);
};

const flushPendingInserts = async (pageKey: PageKey, noteIds: string[]): Promise<void> => {
  if (noteIds.length === 0) {
    return;
  }

  await chrome.runtime.sendMessage({
    type: "panel/flush-pending",
    payload: {
      pageKey,
      noteIds
    }
  } satisfies RuntimeMessage);
};

const consumePendingInserts = async (
  pageKey: PageKey,
  pendingInserts: PendingInsert[]
): Promise<void> => {
  const nextPendingInserts = pendingInserts.filter((item) => !insertedPendingNoteIds.has(item.noteId));

  if (nextPendingInserts.length === 0) {
    return;
  }

  for (const pendingInsert of nextPendingInserts) {
    editorSessionManager.insertMarkdown(pendingInsert.markdownSnippet);
    insertedPendingNoteIds.add(pendingInsert.noteId);
  }

  scheduleDocumentSave();
  await flushPendingInserts(
    pageKey,
    nextPendingInserts.map((item) => item.noteId)
  );
};

const applyPageState = async (pageState: PageViewState): Promise<void> => {
  const pageRecord = pageState.pageRecord;
  const previousPageKey = activePageRecord?.page.key ?? null;
  const nextPageKey = pageRecord?.page.key ?? null;

  if (previousPageKey && previousPageKey !== nextPageKey) {
    await flushPendingDocumentSave();
  }

  if (!pageRecord) {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }

    activePageRecord = null;
    insertedPendingNoteIds = new Set();
    editorSessionManager.clear();
    return;
  }

  deleteCachedDraft(pageRecord.page.key);
  deleteCachedDraft(pageRecord.page.sourceUrl);
  activePageRecord = pageRecord;

  if (previousPageKey !== pageRecord.page.key) {
    insertedPendingNoteIds = new Set();
  }

  await editorSessionManager.ensureSession({
    initialMarkdown: activePageRecord.document.markdown,
    pageKey: pageRecord.page.key,
    onInput: () => {
      scheduleDocumentSave();
    }
  });

  await consumePendingInserts(activePageRecord.page.key, pageState.pendingInserts);
};

const bootstrap = async (): Promise<void> => {
  const response = (await chrome.runtime.sendMessage({
    type: "panel/bootstrap"
  } satisfies RuntimeMessage)) as PageRecordResponse;

  if (!response.ok) {
    console.error("WebNote failed to bootstrap the side panel.", response.reason);
    return;
  }

  await applyPageState(response.pageState);
};

sidePanelPort.onMessage.addListener((message: RuntimeMessage) => {
  if (message.type !== "background/page-updated") {
    return;
  }

  void applyPageState(message.payload);
});

const flushDraftState = (): void => {
  void flushPendingDocumentSave();
};

window.addEventListener("pagehide", flushDraftState);
window.addEventListener("beforeunload", flushDraftState);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    flushDraftState();
  }
});

void bootstrap();
