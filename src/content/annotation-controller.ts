import {
  ANNOTATION_DEFAULT_WIDTH_PX,
  ANNOTATION_MIN_WIDTH_PX,
  ANNOTATION_WIDTH_PREFERENCE_STORAGE_KEY
} from "../shared/constants";
import type { BasicResponse, RuntimeMessage } from "../shared/protocol";
import { createWebAnnotationEntity } from "../shared/serialization";
import type { PageKey, PageRecord, WebAnnotationEntity } from "../shared/types";
import { AnnotationOverlay } from "./annotation-overlay";
import { isExpectedRuntimeLifecycleError } from "./runtime-errors";

const clampPreferredWidth = (width: number): number => Math.max(Math.round(width), ANNOTATION_MIN_WIDTH_PX);

export class AnnotationController {
  private readonly overlay: AnnotationOverlay;
  private readonly annotations = new Map<string, WebAnnotationEntity>();
  private currentPageKey: PageKey | null = null;
  private preferredWidth = ANNOTATION_DEFAULT_WIDTH_PX;

  constructor() {
    this.overlay = new AnnotationOverlay({
      onDelete: async (annotationId) => {
        await this.deleteAnnotation(annotationId);
      },
      onSave: async (input) => this.saveAnnotation(input)
    });
    this.overlay.setPreferredDraftWidth(this.preferredWidth);
    void this.loadPreferredWidth();
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
    this.overlay.openDraftAt(pageX, pageY, this.preferredWidth);
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
    width: number;
    x: number;
    y: number;
  }): Promise<WebAnnotationEntity> {
    const existingAnnotation = input.annotationId ? this.annotations.get(input.annotationId) ?? null : null;
    const nextAnnotation = existingAnnotation
      ? {
          ...existingAnnotation,
          content: input.content.trim(),
          width: Math.round(input.width),
          x: Math.round(input.x),
          y: Math.round(input.y),
          updatedAt: new Date().toISOString()
        }
      : createWebAnnotationEntity({
          content: input.content,
          pageKey: input.pageKey,
          width: input.width,
          x: input.x,
          y: input.y
        });

    let response: BasicResponse;

    try {
      response = (await chrome.runtime.sendMessage({
        type: "content/upsert-annotation",
        payload: {
          annotation: nextAnnotation
        }
      } satisfies RuntimeMessage)) as BasicResponse;
    } catch (error) {
      if (isExpectedRuntimeLifecycleError(error)) {
        throw error;
      }

      throw error;
    }

    if (!response.ok) {
      throw new Error(response.reason ?? "Failed to save the web annotation.");
    }

    this.updatePreferredWidth(nextAnnotation.width);
    this.annotations.set(nextAnnotation.id, nextAnnotation);
    return nextAnnotation;
  }

  private async deleteAnnotation(annotationId: string): Promise<void> {
    const annotation = this.annotations.get(annotationId);

    if (!annotation) {
      return;
    }

    let response: BasicResponse;

    try {
      response = (await chrome.runtime.sendMessage({
        type: "content/delete-annotation",
        payload: {
          annotationId,
          pageKey: annotation.pageKey
        }
      } satisfies RuntimeMessage)) as BasicResponse;
    } catch (error) {
      if (isExpectedRuntimeLifecycleError(error)) {
        throw error;
      }

      throw error;
    }

    if (!response.ok) {
      throw new Error(response.reason ?? "Failed to delete the web annotation.");
    }

    this.annotations.delete(annotationId);
  }

  private async loadPreferredWidth(): Promise<void> {
    try {
      const storageResult = await chrome.storage.local.get(ANNOTATION_WIDTH_PREFERENCE_STORAGE_KEY);
      const candidateWidth = storageResult[ANNOTATION_WIDTH_PREFERENCE_STORAGE_KEY];

      if (typeof candidateWidth !== "number") {
        return;
      }

      this.updatePreferredWidth(candidateWidth);
    } catch (error) {
      if (isExpectedRuntimeLifecycleError(error)) {
        return;
      }

      console.warn("WebNote failed to load the preferred annotation width.", error);
    }
  }

  private updatePreferredWidth(width: number): void {
    const nextPreferredWidth = clampPreferredWidth(width);

    if (this.preferredWidth === nextPreferredWidth) {
      this.overlay.setPreferredDraftWidth(nextPreferredWidth);
      return;
    }

    this.preferredWidth = nextPreferredWidth;
    this.overlay.setPreferredDraftWidth(this.preferredWidth);
    void chrome.storage.local
      .set({
        [ANNOTATION_WIDTH_PREFERENCE_STORAGE_KEY]: this.preferredWidth
      })
      .catch((error) => {
        if (isExpectedRuntimeLifecycleError(error)) {
          return;
        }

        console.warn("WebNote failed to persist the preferred annotation width.", error);
      });
  }
}
