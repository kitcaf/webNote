import type { PageRecordResponse, RuntimeMessage } from "../shared/protocol";
import { createPageDescriptor } from "../shared/serialization";
import type { PageDescriptor, PageViewState } from "../shared/types";

interface PageLifecycleCoordinatorOptions {
  onPageChange: (page: PageDescriptor) => void;
  onPageStateReady: (pageState: PageViewState) => void;
  pageRoot: HTMLElement;
}

const DOM_QUIET_WINDOW_MS = 180;
const DOM_REHYDRATE_DEBOUNCE_MS = 220;
const DOM_STABILITY_MAX_WAIT_MS = 2500;
const POST_LAYOUT_RAF_COUNT = 2;

const isOverlayNode = (node: Node | null): boolean => {
  if (!node) {
    return false;
  }

  if (node instanceof Element) {
    return Boolean(node.closest("[data-webnote-overlay='true']"));
  }

  return node.parentElement ? Boolean(node.parentElement.closest("[data-webnote-overlay='true']")) : false;
};

const mutationAffectsPageContent = (mutationRecords: MutationRecord[]): boolean =>
  mutationRecords.some((mutationRecord) => {
    if (isOverlayNode(mutationRecord.target)) {
      return false;
    }

    if (mutationRecord.type === "characterData") {
      return true;
    }

    return (
      [...mutationRecord.addedNodes].some((node) => !isOverlayNode(node)) ||
      [...mutationRecord.removedNodes].some((node) => !isOverlayNode(node))
    );
  });

export class PageLifecycleCoordinator {
  private currentPage: PageDescriptor = createPageDescriptor(window.location.href, document.title);
  private currentPageState: PageViewState = {
    pageRecord: null,
    pendingInserts: [],
    tabId: null
  };
  private readonly domRebuildObserver: MutationObserver;
  private domRehydrateTimer: number | null = null;
  private lifecycleRevision = 0;

  constructor(private readonly options: PageLifecycleCoordinatorOptions) {
    this.domRebuildObserver = new MutationObserver((mutationRecords) => {
      if (!mutationAffectsPageContent(mutationRecords)) {
        return;
      }

      this.scheduleDomRehydrate();
    });

    this.domRebuildObserver.observe(this.options.pageRoot, {
      characterData: true,
      childList: true,
      subtree: true
    });
  }

  dispose(): void {
    if (this.domRehydrateTimer !== null) {
      window.clearTimeout(this.domRehydrateTimer);
      this.domRehydrateTimer = null;
    }

    this.domRebuildObserver.disconnect();
  }

  getCurrentPage(): PageDescriptor {
    return this.currentPage;
  }

  async sync(type: "content/page-ready" | "content/page-changed"): Promise<void> {
    const nextPage = createPageDescriptor(window.location.href, document.title);
    const didIdentityChange = nextPage.key !== this.currentPage.key;
    this.currentPage = nextPage;
    this.options.onPageChange(this.currentPage);

    if (type === "content/page-changed" && !didIdentityChange) {
      return;
    }

    const response = (await chrome.runtime.sendMessage({
      type,
      payload: {
        page: this.currentPage
      }
    } satisfies RuntimeMessage)) as PageRecordResponse;

    if (!response.ok) {
      console.error("Failed to load the page record.", response.reason);
      return;
    }

    this.applyPageState(response.pageState);
  }

  applyPageState(pageState: PageViewState): void {
    if (pageState.pageRecord && pageState.pageRecord.page.key !== this.currentPage.key) {
      return;
    }

    this.currentPageState = pageState;
    this.scheduleStableHydration();
  }

  private scheduleStableHydration(): void {
    const lifecycleRevision = ++this.lifecycleRevision;

    void this.waitForStablePage().then(() => {
      if (lifecycleRevision !== this.lifecycleRevision) {
        return;
      }

      this.options.onPageStateReady(this.currentPageState);
    });
  }

  private scheduleDomRehydrate(): void {
    if (this.currentPageState.pageRecord === null) {
      return;
    }

    if (this.domRehydrateTimer !== null) {
      window.clearTimeout(this.domRehydrateTimer);
    }

    this.domRehydrateTimer = window.setTimeout(() => {
      this.domRehydrateTimer = null;
      this.scheduleStableHydration();
    }, DOM_REHYDRATE_DEBOUNCE_MS);
  }

  private async waitForStablePage(): Promise<void> {
    await this.waitForDocumentLoad();

    for (let frameIndex = 0; frameIndex < POST_LAYOUT_RAF_COUNT; frameIndex += 1) {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      let quietTimer: number | null = null;
      let maxWaitTimer: number | null = null;
      const quietObserver = new MutationObserver((mutationRecords) => {
        if (!mutationAffectsPageContent(mutationRecords)) {
          return;
        }

        scheduleQuietWindow();
      });

      const finalize = (): void => {
        if (settled) {
          return;
        }

        settled = true;

        if (quietTimer !== null) {
          window.clearTimeout(quietTimer);
        }

        if (maxWaitTimer !== null) {
          window.clearTimeout(maxWaitTimer);
        }

        quietObserver.disconnect();
        resolve();
      };

      const scheduleQuietWindow = (): void => {
        if (quietTimer !== null) {
          window.clearTimeout(quietTimer);
        }

        quietTimer = window.setTimeout(() => {
          finalize();
        }, DOM_QUIET_WINDOW_MS);
      };

      quietObserver.observe(this.options.pageRoot, {
        characterData: true,
        childList: true,
        subtree: true
      });

      maxWaitTimer = window.setTimeout(() => {
        finalize();
      }, DOM_STABILITY_MAX_WAIT_MS);

      scheduleQuietWindow();
    });
  }

  private async waitForDocumentLoad(): Promise<void> {
    if (document.readyState === "complete") {
      return;
    }

    await new Promise<void>((resolve) => {
      const handleLoad = (): void => {
        window.removeEventListener("load", handleLoad);
        resolve();
      };

      window.addEventListener("load", handleLoad, { once: true });
    });
  }
}
