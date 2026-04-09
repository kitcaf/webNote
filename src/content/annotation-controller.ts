import type { BasicResponse, RuntimeMessage } from "../shared/protocol";
import { createWebAnnotationEntity } from "../shared/serialization";
import type { PageKey, PageRecord, WebAnnotationEntity } from "../shared/types";
import { AnnotationOverlay } from "./annotation-overlay";

export class AnnotationController {
  private readonly overlay: AnnotationOverlay;
  private readonly annotations = new Map<string, WebAnnotationEntity>();
  private currentPageKey: PageKey | null = null;

  constructor() {
    this.overlay = new AnnotationOverlay({
      onDelete: async (annotationId) => {
        await this.deleteAnnotation(annotationId);
      },
      onSave: async (input) => this.saveAnnotation(input)
    });
  }

  isOwnedTarget(target: EventTarget | null): boolean {
    return this.overlay.isOwnedTarget(target);
  }

  setInteractive(interactive: boolean): void {
    this.overlay.setInteractive(interactive);
  }

  setPageKey(pageKey: PageKey): void {
    if (this.currentPageKey === pageKey) {
      return;
    }

    this.currentPageKey = pageKey;
    this.annotations.clear();
    this.overlay.setPageKey(pageKey);
    this.overlay.hydrate([]);
  }

  hydrate(pageRecord: PageRecord | null): void {
    this.annotations.clear();

    if (!pageRecord) {
      this.overlay.hydrate([]);
      return;
    }

    this.currentPageKey = pageRecord.page.key;
    this.overlay.setPageKey(pageRecord.page.key);

    for (const annotation of pageRecord.annotations) {
      this.annotations.set(annotation.id, annotation);
    }

    this.overlay.hydrate([...this.annotations.values()]);
  }

  openDraftAt(pageX: number, pageY: number): void {
    this.overlay.openDraftAt(pageX, pageY);
  }

  cancelDraft(): void {
    this.overlay.cancelDraft();
  }

  async flushDraft(): Promise<void> {
    await this.overlay.flushDraft();
  }

  private async saveAnnotation(input: {
    annotationId?: string;
    content: string;
    pageKey: PageKey;
    x: number;
    y: number;
  }): Promise<WebAnnotationEntity> {
    const existingAnnotation = input.annotationId ? this.annotations.get(input.annotationId) ?? null : null;
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

    this.annotations.set(nextAnnotation.id, nextAnnotation);
    return nextAnnotation;
  }

  private async deleteAnnotation(annotationId: string): Promise<void> {
    const annotation = this.annotations.get(annotationId);

    if (!annotation) {
      return;
    }

    const response = (await chrome.runtime.sendMessage({
      type: "content/delete-annotation",
      payload: {
        annotationId,
        pageKey: annotation.pageKey
      }
    } satisfies RuntimeMessage)) as BasicResponse;

    if (!response.ok) {
      throw new Error(response.reason ?? "Failed to delete the web annotation.");
    }

    this.annotations.delete(annotationId);
  }
}
