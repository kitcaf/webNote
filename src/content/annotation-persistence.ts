import {
  ANNOTATION_MIN_WIDTH_PX,
  ANNOTATION_WIDTH_PREFERENCE_STORAGE_KEY
} from "../shared/constants";
import type { BasicResponse, RuntimeMessage } from "../shared/protocol";
import { createWebAnnotationEntity } from "../shared/serialization";
import type { WebAnnotationEntity } from "../shared/types";
import { isExpectedRuntimeLifecycleError } from "./runtime-errors";
import type { AnnotationSession } from "./annotation-state-machine";

export type AnnotationCommitResult =
  | {
      kind: "discard";
    }
  | {
      annotationId: string;
      kind: "delete";
    }
  | {
      annotation: WebAnnotationEntity;
      kind: "save";
    };

export class AnnotationPersistence {
  async commitSession(
    session: AnnotationSession,
    storedAnnotation: WebAnnotationEntity | null
  ): Promise<AnnotationCommitResult> {
    const trimmedDraftText = session.draftText.trim();

    if (!trimmedDraftText) {
      if (!session.annotationId) {
        return {
          kind: "discard"
        };
      }

      if (!storedAnnotation) {
        return {
          annotationId: session.annotationId,
          kind: "delete"
        };
      }

      await this.deleteAnnotation(storedAnnotation);
      return {
        annotationId: session.annotationId,
        kind: "delete"
      };
    }

    const nextAnnotation = storedAnnotation
      ? {
          ...storedAnnotation,
          content: trimmedDraftText,
          width: Math.round(session.frame.width),
          x: Math.round(session.frame.x),
          y: Math.round(session.frame.y),
          updatedAt: new Date().toISOString()
        }
      : createWebAnnotationEntity({
          content: trimmedDraftText,
          pageKey: session.pageKey,
          width: session.frame.width,
          x: session.frame.x,
          y: session.frame.y
        });

    await this.upsertAnnotation(nextAnnotation);
    return {
      annotation: nextAnnotation,
      kind: "save"
    };
  }

  async deleteAnnotation(annotation: WebAnnotationEntity): Promise<void> {
    let response: BasicResponse;

    try {
      response = (await chrome.runtime.sendMessage({
        type: "content/delete-annotation",
        payload: {
          annotationId: annotation.id,
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
  }

  async loadPreferredWidth(): Promise<number | null> {
    try {
      const storageResult = await chrome.storage.local.get(ANNOTATION_WIDTH_PREFERENCE_STORAGE_KEY);
      const candidateWidth = storageResult[ANNOTATION_WIDTH_PREFERENCE_STORAGE_KEY];
      return typeof candidateWidth === "number" ? candidateWidth : null;
    } catch (error) {
      if (isExpectedRuntimeLifecycleError(error)) {
        return null;
      }

      console.warn("WebNote failed to load the preferred annotation width.", error);
      return null;
    }
  }

  persistPreferredWidth(width: number): void {
    const nextPreferredWidth = Math.max(Math.round(width), ANNOTATION_MIN_WIDTH_PX);
    void chrome.storage.local
      .set({
        [ANNOTATION_WIDTH_PREFERENCE_STORAGE_KEY]: nextPreferredWidth
      })
      .catch((error) => {
        if (isExpectedRuntimeLifecycleError(error)) {
          return;
        }

        console.warn("WebNote failed to persist the preferred annotation width.", error);
      });
  }

  private async upsertAnnotation(annotation: WebAnnotationEntity): Promise<void> {
    let response: BasicResponse;

    try {
      response = (await chrome.runtime.sendMessage({
        type: "content/upsert-annotation",
        payload: {
          annotation
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
  }
}
