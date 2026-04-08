import "../styles/sidepanel.css";

import { DOCUMENT_SAVE_DEBOUNCE_MS, SIDEPANEL_PORT_NAME } from "../shared/constants";
import type { BasicResponse, PageRecordResponse, RuntimeMessage } from "../shared/protocol";
import type { PageKey, PageRecord } from "../shared/types";
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

const persistDocument = async (): Promise<void> => {
  if (!activePageRecord) {
    return;
  }

  const response = (await chrome.runtime.sendMessage({
    type: "panel/save-document",
    payload: {
      pageKey: activePageRecord.page.key,
      markdown: editorSessionManager.getMarkdown()
    }
  } satisfies RuntimeMessage)) as BasicResponse;

  if (!response.ok) {
    console.error("WebNote failed to save the current document.", response.reason);
  }
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

const consumePendingInserts = async (pageRecord: PageRecord): Promise<void> => {
  const pendingInserts = pageRecord.pendingInserts.filter((item) => !insertedPendingNoteIds.has(item.noteId));

  if (pendingInserts.length === 0) {
    return;
  }

  for (const pendingInsert of pendingInserts) {
    editorSessionManager.insertMarkdown(pendingInsert.markdownSnippet);
    insertedPendingNoteIds.add(pendingInsert.noteId);
  }

  scheduleDocumentSave();
  await flushPendingInserts(
    pageRecord.page.key,
    pendingInserts.map((item) => item.noteId)
  );
};

const applyPageRecord = async (pageRecord: PageRecord | null): Promise<void> => {
  const previousPageKey = activePageRecord?.page.key ?? null;
  activePageRecord = pageRecord;

  if (!pageRecord) {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }

    insertedPendingNoteIds = new Set();
    editorSessionManager.clear();
    return;
  }

  if (previousPageKey !== pageRecord.page.key) {
    insertedPendingNoteIds = new Set();
  }

  await editorSessionManager.ensureSession({
    initialMarkdown: pageRecord.document.markdown,
    pageKey: pageRecord.page.key,
    onInput: () => {
      scheduleDocumentSave();
    }
  });

  await consumePendingInserts(pageRecord);
};

const bootstrap = async (): Promise<void> => {
  const response = (await chrome.runtime.sendMessage({
    type: "panel/bootstrap"
  } satisfies RuntimeMessage)) as PageRecordResponse;

  if (!response.ok) {
    console.error("WebNote failed to bootstrap the side panel.", response.reason);
    return;
  }

  await applyPageRecord(response.pageRecord);
};

sidePanelPort.onMessage.addListener((message: RuntimeMessage) => {
  if (message.type !== "background/page-updated") {
    return;
  }

  void applyPageRecord(message.payload.pageRecord);
});

void bootstrap();
