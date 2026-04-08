import type { PageRecordResponse, RuntimeMessage } from "../shared/protocol";
import { createPageDescriptor } from "../shared/serialization";
import type { PageDescriptor, PageRecord } from "../shared/types";

interface PageSyncControllerOptions {
  onPageChange: (page: PageDescriptor) => void;
  onPageRecord: (pageRecord: PageRecord | null) => void;
}

export class PageSyncController {
  private currentPage: PageDescriptor = createPageDescriptor(window.location.href, document.title);

  constructor(private readonly options: PageSyncControllerOptions) {}

  getCurrentPage(): PageDescriptor {
    return this.currentPage;
  }

  async sync(type: "content/page-ready" | "content/page-changed"): Promise<void> {
    this.currentPage = createPageDescriptor(window.location.href, document.title);
    this.options.onPageChange(this.currentPage);

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

    this.options.onPageRecord(response.pageRecord);
  }
}
