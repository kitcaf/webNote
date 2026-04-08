import {
  CAPTURE_COMMAND,
  CONTEXT_MENU_ID,
  SIDEPANEL_PORT_NAME
} from "../shared/constants";
import type {
  BasicResponse,
  PageRecordResponse,
  RuntimeMessage
} from "../shared/protocol";
import { createPageDescriptor } from "../shared/serialization";
import type { PageDescriptor, PageRecord } from "../shared/types";
import {
  deleteNote,
  deleteAnnotation,
  flushPendingInserts,
  getPageRecord,
  getOrCreatePageRecord,
  saveDocument,
  upsertAnnotation,
  upsertNote
} from "./storage";

const trackedPagesByTab = new Map<number, PageDescriptor>();
const sidePanelPorts = new Set<chrome.runtime.Port>();
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

const ensureSidePanelBehavior = async (): Promise<void> => {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }

  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
  });
};

const getActiveTab = async (): Promise<chrome.tabs.Tab | null> => {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0] ?? null;
};

const getPageForTab = async (tab: chrome.tabs.Tab | null): Promise<PageDescriptor | null> => {
  if (!tab?.id || !isSupportedUrl(tab.url)) {
    return null;
  }

  const trackedPage = trackedPagesByTab.get(tab.id);
  const fallbackPage = createPageDescriptor(tab.url, tab.title ?? "");

  if (trackedPage && trackedPage.key === fallbackPage.key) {
    return trackedPage;
  }

  return fallbackPage;
};

const getActivePageRecord = async (): Promise<{ pageRecord: PageRecord | null; tabId: number | null }> => {
  const activeTab = await getActiveTab();

  if (!activeTab?.id) {
    return {
      pageRecord: null,
      tabId: null
    };
  }

  const page = await getPageForTab(activeTab);

  if (!page) {
    return {
      pageRecord: null,
      tabId: activeTab.id
    };
  }

  const existingPageRecord = await getPageRecord(page.key);

  return {
    pageRecord: existingPageRecord ?? (await getOrCreatePageRecord(page)),
    tabId: activeTab.id
  };
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

const broadcastToSidePanelPorts = (message: RuntimeMessage): void => {
  for (const port of sidePanelPorts) {
    try {
      port.postMessage(message);
    } catch (error) {
      console.error("Failed to notify the side panel.", error);
      sidePanelPorts.delete(port);
    }
  }
};

const broadcastActivePage = async (): Promise<void> => {
  const state = await getActivePageRecord();
  broadcastToSidePanelPorts({
    type: "background/page-updated",
    payload: state
  } satisfies RuntimeMessage);
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

const openPanel = async (tabId: number): Promise<void> => {
  if (!chrome.sidePanel?.open) {
    return;
  }

  try {
    await chrome.sidePanel.open({ tabId });
  } catch (error) {
    console.error("Failed to open the side panel.", error);
  }
};

const locateTabForPageKey = async (pageKey: string): Promise<number | null> => {
  const activeTab = await getActiveTab();
  const trackedActiveKey = activeTab?.id ? trackedPagesByTab.get(activeTab.id)?.key : null;

  if (activeTab?.id && trackedActiveKey === pageKey) {
    return activeTab.id;
  }

  for (const [tabId, page] of trackedPagesByTab.entries()) {
    if (page.key === pageKey) {
      return tabId;
    }
  }

  return activeTab?.id ?? null;
};

const handleBackgroundMessage = async (
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender
): Promise<BasicResponse | PageRecordResponse | undefined> => {
  switch (message.type) {
    case "content/page-ready":
    case "content/page-changed": {
      if (sender.tab?.id) {
        trackedPagesByTab.set(sender.tab.id, message.payload.page);
      }

      const pageRecord = await getOrCreatePageRecord(message.payload.page);

      if (sender.tab?.active) {
        await broadcastActivePage();
      }

      return {
        ok: true,
        pageRecord,
        tabId: sender.tab?.id ?? null
      };
    }

    case "content/create-note": {
      const shouldOpenSidePanel = message.payload.options?.openSidePanel ?? true;
      const pageRecord = await upsertNote(message.payload.note, {
        enqueueInsert: message.payload.options?.enqueueInsert ?? true
      });

      if (sender.tab?.id) {
        trackedPagesByTab.set(sender.tab.id, {
          key: message.payload.note.pageKey,
          title: message.payload.note.pageTitle,
          url: message.payload.note.pageUrl,
          lastSeenAt: message.payload.note.updatedAt
        });

        if (shouldOpenSidePanel) {
          await openPanel(sender.tab.id);
        }
      }

      await broadcastActivePage();

      return { ok: true };
    }

    case "content/open-side-panel": {
      if (sender.tab?.id) {
        await openPanel(sender.tab.id);
      }

      return { ok: true };
    }

    case "content/upsert-annotation": {
      await upsertAnnotation(message.payload.annotation);
      await broadcastActivePage();
      return { ok: true };
    }

    case "content/delete-annotation": {
      await deleteAnnotation(message.payload.pageKey, message.payload.annotationId);
      await broadcastActivePage();
      return { ok: true };
    }

    case "content/delete-note": {
      await deleteNote(message.payload.pageKey, message.payload.noteId);
      await broadcastActivePage();
      return { ok: true };
    }

    case "panel/bootstrap": {
      const state = await getActivePageRecord();
      return {
        ok: true,
        pageRecord: state.pageRecord,
        tabId: state.tabId
      };
    }

    case "panel/save-document": {
      const pageRecord = await saveDocument(message.payload.pageKey, message.payload.markdown);
      return {
        ok: true,
        reason: pageRecord ? undefined : "No page record found for the requested document."
      };
    }

    case "panel/flush-pending": {
      await flushPendingInserts(message.payload.pageKey, message.payload.noteIds);
      return { ok: true };
    }

    case "panel/open-source": {
      const tabId = await locateTabForPageKey(message.payload.pageKey);

      if (!tabId) {
        return {
          ok: false,
          reason: "Could not find an open tab for the requested page."
        };
      }

      try {
        await chrome.tabs.update(tabId, {
          active: true
        });

        const didDeliver = await sendTabMessage(tabId, {
          type: "content/activate-note",
          payload: message.payload
        } satisfies RuntimeMessage);

        if (!didDeliver) {
          return {
            ok: false,
            reason: "The target page is still loading and cannot receive note navigation yet."
          };
        }
      } catch (error) {
        console.error("Failed to locate the source quote in the page.", error);
        return {
          ok: false,
          reason: "Failed to send the navigation request to the page."
        };
      }

      return { ok: true };
    }

    default:
      return undefined;
  }
};

chrome.runtime.onInstalled.addListener(() => {
  void ensureContextMenu();
  void ensureSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureContextMenu();
  void ensureSidePanelBehavior();
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

chrome.tabs.onActivated.addListener(() => {
  void broadcastActivePage();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  trackedPagesByTab.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    trackedPagesByTab.delete(tabId);
  }

  if (changeInfo.status === "complete" && tab.active) {
    void broadcastActivePage();
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== SIDEPANEL_PORT_NAME) {
    return;
  }

  sidePanelPorts.add(port);
  port.onDisconnect.addListener(() => {
    sidePanelPorts.delete(port);
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
