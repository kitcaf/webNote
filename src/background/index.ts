import {
  CAPTURE_COMMAND,
  CONTEXT_MENU_ID
} from "../shared/constants";
import type {
  BasicResponse,
  PageRecordResponse,
  RuntimeMessage
} from "../shared/protocol";
import type { PageViewState } from "../shared/types";
import {
  deleteAnnotation,
  deleteNote,
  getOrCreatePageRecord,
  replaceAnnotations,
  upsertAnnotation,
  upsertNote
} from "./storage";

const NO_RECEIVER_ERROR_FRAGMENT = "Receiving end does not exist";
const MESSAGE_PORT_CLOSED_ERROR_FRAGMENT = "The message port closed before a response was received";

const isSupportedUrl = (rawUrl?: string): rawUrl is string => {
  if (!rawUrl) {
    return false;
  }

  return rawUrl.startsWith("http://") || rawUrl.startsWith("https://");
};

const ensureContextMenu = async (): Promise<void> => {
  await chrome.contextMenus.removeAll();
  await chrome.contextMenus.create({
    contexts: ["selection"],
    id: CONTEXT_MENU_ID,
    title: "Add selection to WebNote"
  });
};

const getActiveTab = async (): Promise<chrome.tabs.Tab | null> => {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0] ?? null;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error);
};

const isNoReceiverError = (error: unknown): boolean => {
  const errorMessage = getErrorMessage(error);
  return (
    errorMessage.includes(NO_RECEIVER_ERROR_FRAGMENT) ||
    errorMessage.includes(MESSAGE_PORT_CLOSED_ERROR_FRAGMENT)
  );
};

const sendTabMessage = async (tabId: number, message: RuntimeMessage): Promise<boolean> => {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (error) {
    if (isNoReceiverError(error)) {
      return false;
    }

    throw error;
  }
};

const requestSelectionCapture = async (tabId: number): Promise<void> => {
  try {
    const didDeliver = await sendTabMessage(tabId, {
      type: "content/capture-selection"
    } satisfies RuntimeMessage);

    if (!didDeliver) {
      console.warn("WebNote skipped selection capture because the content script is not ready in the current tab yet.");
    }
  } catch (error) {
    console.error("Failed to ask the content script to capture the selection.", error);
  }
};

const createPageState = (pageRecord: Awaited<ReturnType<typeof getOrCreatePageRecord>>, tabId: number | null): PageViewState => ({
  pageRecord,
  pendingInserts: [],
  tabId
});

const handleBackgroundMessage = async (
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender
): Promise<BasicResponse | PageRecordResponse | undefined> => {
  switch (message.type) {
    case "content/page-ready":
    case "content/page-changed": {
      const pageRecord = await getOrCreatePageRecord(message.payload.page);

      return {
        ok: true,
        pageState: createPageState(pageRecord, sender.tab?.id ?? null)
      };
    }

    case "content/create-note": {
      await upsertNote(message.payload.note, {
        enqueueInsert: message.payload.options?.enqueueInsert ?? true
      });
      return { ok: true };
    }

    case "content/upsert-annotation": {
      await upsertAnnotation(message.payload.annotation);
      return { ok: true };
    }

    case "content/delete-annotation": {
      await deleteAnnotation(message.payload.pageKey, message.payload.annotationId);
      return { ok: true };
    }

    case "content/replace-annotations": {
      await replaceAnnotations(message.payload.pageKey, message.payload.annotations);
      return { ok: true };
    }

    case "content/delete-note": {
      await deleteNote(message.payload.pageKey, message.payload.noteId);
      return { ok: true };
    }

    default:
      return undefined;
  }
};

chrome.runtime.onInstalled.addListener(() => {
  void ensureContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) {
    return;
  }

  void requestSelectionCapture(tab.id);
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== CAPTURE_COMMAND) {
    return;
  }

  void getActiveTab().then((activeTab) => {
    if (activeTab?.id) {
      void requestSelectionCapture(activeTab.id);
    }
  });
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  void handleBackgroundMessage(message, sender)
    .then((response) => {
      sendResponse(response);
    })
    .catch((error) => {
      console.error("Background message handling failed.", error);
      sendResponse({
        ok: false,
        reason: error instanceof Error ? error.message : "Unknown error"
      } satisfies BasicResponse);
    });

  return true;
});
