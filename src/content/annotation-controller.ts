import {
  ANNOTATION_AUTOSAVE_DEBOUNCE_MS,
  ANNOTATION_DEFAULT_WIDTH_PX,
  ANNOTATION_MIN_WIDTH_PX
} from "../shared/constants";
import {
  DEFAULT_ANNOTATION_COLOR_TOKEN,
  normalizeColorToken,
  type ColorToken
} from "../shared/colors";
import type { PageKey, PageRecord, WebAnnotationEntity } from "../shared/types";
import { AnnotationCanvas } from "./annotation-canvas";
import { constrainInteractiveAnnotationFrame, type AnnotationFrame } from "./annotation-dom";
import { AnnotationEditor } from "./annotation-editor";
import {
  AnnotationPersistence,
  type AnnotationCommitResult
} from "./annotation-persistence";
import { AnnotationPointerController } from "./annotation-pointer-controller";
import { isExpectedRuntimeLifecycleError } from "./runtime-errors";
import { AnnotationStateMachine, type AnnotationSession } from "./annotation-state-machine";
import { AnnotationStore } from "./annotation-store";

interface CommitOptions {
  closeOnSuccess: boolean;
  reopenOnFailure: boolean;
}

const buildCommitKey = (session: AnnotationSession): string =>
  `${session.sessionId}:${session.draftRevision}`;

const toFrame = (annotation: Pick<WebAnnotationEntity, "width" | "x" | "y">): AnnotationFrame => ({
  width: annotation.width,
  x: annotation.x,
  y: annotation.y
});

const cloneFrame = (frame: AnnotationFrame): AnnotationFrame => ({
  width: frame.width,
  x: frame.x,
  y: frame.y
});

const buildAnnotationHydrationSnapshot = (pageRecord: PageRecord | null): string =>
  JSON.stringify(
    pageRecord
      ? {
          annotations: pageRecord.annotations.map((annotation) => ({
            colorToken: annotation.colorToken,
            content: annotation.content,
            id: annotation.id,
            pageKey: annotation.pageKey,
            updatedAt: annotation.updatedAt,
            width: annotation.width,
            x: annotation.x,
            y: annotation.y
          })),
          pageKey: pageRecord.page.key
        }
      : {
          annotations: [],
          pageKey: null
        }
  );

export class AnnotationController {
  private readonly canvas: AnnotationCanvas;
  private readonly commitRequests = new Map<string, Promise<AnnotationCommitResult>>();
  private readonly editor: AnnotationEditor;
  private readonly persistence = new AnnotationPersistence();
  private readonly pointerController = new AnnotationPointerController();
  private readonly stateMachine = new AnnotationStateMachine();
  private readonly store = new AnnotationStore();
  private autosaveTimer: number | null = null;
  private currentPageKey: PageKey | null = null;
  private hydratedAnnotationSnapshot = buildAnnotationHydrationSnapshot(null);
  private interactive = false;
  private preferredColorToken = DEFAULT_ANNOTATION_COLOR_TOKEN;
  private preferredWidth = ANNOTATION_DEFAULT_WIDTH_PX;

  constructor() {
    this.canvas = new AnnotationCanvas({
      onDelete: (annotationId) => {
        void this.deleteAnnotation(annotationId);
      },
      onPointerDown: (annotationId, target, event) => {
        this.handleCanvasPointerDown(annotationId, target, event);
      }
    });
    this.editor = new AnnotationEditor({
      onBlurRequest: () => {
        if (this.pointerController.isActive()) {
          return;
        }

        void this.finalizeEditingSession({
          reopenOnFailure: true
        });
      },
      onEscape: () => {
        this.cancelDraft();
      },
      onInput: (draftText) => {
        this.handleEditorInput(draftText);
      },
      onResizePointerDown: (event) => {
        this.handleEditorResizePointerDown(event);
      }
    });
    void this.loadPreferredWidth();
  }

  isOwnedTarget(target: EventTarget | null): boolean {
    return this.canvas.isOwnedTarget(target) || this.editor.isOwnedTarget(target);
  }

  setInteractive(interactive: boolean): void {
    this.interactive = interactive;
    this.canvas.setInteractive(interactive);

    if (!interactive) {
      this.pointerController.clear();
    }
  }

  setColorToken(colorToken: ColorToken): void {
    const normalizedColorToken = normalizeColorToken(
      colorToken,
      DEFAULT_ANNOTATION_COLOR_TOKEN
    );
    this.preferredColorToken = normalizedColorToken;

    const activeSession = this.stateMachine.getSession();

    if (!activeSession || activeSession.colorToken === normalizedColorToken) {
      return;
    }

    const updatedSession = this.stateMachine.updateColorToken(
      activeSession.sessionId,
      normalizedColorToken
    );

    if (!updatedSession) {
      return;
    }

    this.editor.setColorToken(updatedSession.colorToken);
    this.previewActiveSession(updatedSession);
  }

  setPageKey(pageKey: PageKey): void {
    if (this.currentPageKey === pageKey) {
      return;
    }

    this.currentPageKey = pageKey;
    this.hydratedAnnotationSnapshot = buildAnnotationHydrationSnapshot(null);
    this.resetRuntimeState();
    this.store.clear();
    this.canvas.setAnnotations([]);
  }

  hydrate(pageRecord: PageRecord | null): void {
    this.canvas.ensureAttached();
    this.editor.ensureAttached();

    const nextHydratedSnapshot = buildAnnotationHydrationSnapshot(pageRecord);

    if (this.hydratedAnnotationSnapshot === nextHydratedSnapshot) {
      return;
    }

    this.resetRuntimeState();
    this.store.clear();
    this.hydratedAnnotationSnapshot = nextHydratedSnapshot;

    if (!pageRecord) {
      this.canvas.setAnnotations([]);
      return;
    }

    this.currentPageKey = pageRecord.page.key;
    this.store.setAll(pageRecord.annotations);
    this.canvas.setAnnotations(this.store.getAll());
  }

  openDraftAt(pageX: number, pageY: number): void {
    if (!this.currentPageKey) {
      return;
    }

    this.beginNextSession(() => {
      const session = this.stateMachine.openDraft({
        colorToken: this.preferredColorToken,
        draftText: "",
        frame: constrainInteractiveAnnotationFrame({
          width: this.preferredWidth,
          x: pageX,
          y: pageY
        }),
        pageKey: this.currentPageKey as PageKey
      });
      this.canvas.setHiddenAnnotation(null);
      this.editor.open(session);
      this.editor.focus();
    });
  }

  cancelDraft(): void {
    const activeSession = this.stateMachine.getSession();
    this.clearAutosaveTimer();
    this.pointerController.clear();
    this.editor.close();
    this.canvas.setHiddenAnnotation(null);

    if (activeSession?.annotationId) {
      this.syncStoredAnnotation(activeSession.annotationId);
    }

    this.stateMachine.clear();
  }

  async flushDraft(): Promise<void> {
    await this.finalizeEditingSession({
      reopenOnFailure: false
    });
  }

  private beginNextSession(start: () => void): void {
    const activeSession = this.stateMachine.getSession();

    this.pointerController.clear();
    this.clearAutosaveTimer();

    if (!activeSession) {
      start();
      return;
    }

    this.editor.close();
    this.canvas.setHiddenAnnotation(null);

    const trimmedDraftText = activeSession.draftText.trim();

    if (!trimmedDraftText && activeSession.annotationId) {
      void this.deleteStoredAnnotation(activeSession.annotationId);
    } else if (trimmedDraftText) {
      this.previewActiveSession(activeSession);
      void this.dispatchCommit(activeSession, {
        closeOnSuccess: false,
        reopenOnFailure: false
      });
    } else if (activeSession.annotationId) {
      this.syncStoredAnnotation(activeSession.annotationId);
    }

    this.stateMachine.clear(activeSession.sessionId);
    start();
  }

  private clearAutosaveTimer(): void {
    if (this.autosaveTimer === null) {
      return;
    }

    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  private async deleteAnnotation(annotationId: string): Promise<void> {
    const annotation = this.store.get(annotationId);

    if (!annotation) {
      return;
    }

    this.closeSessionIfEditingAnnotation(annotationId);
    this.store.remove(annotationId);
    this.canvas.removeAnnotation(annotationId);

    try {
      await this.persistence.deleteAnnotation(annotation);
    } catch (error) {
      if (isExpectedRuntimeLifecycleError(error)) {
        return;
      }

      this.restoreAnnotation(annotation);
      console.error("WebNote failed to delete the page annotation.", error);
    }
  }

  private async deleteStoredAnnotation(annotationId: string): Promise<void> {
    const annotation = this.store.get(annotationId);

    if (!annotation) {
      return;
    }

    this.store.remove(annotationId);
    this.canvas.removeAnnotation(annotationId);

    try {
      await this.persistence.deleteAnnotation(annotation);
    } catch (error) {
      if (isExpectedRuntimeLifecycleError(error)) {
        return;
      }

      this.restoreAnnotation(annotation);
      console.error("WebNote failed to delete the page annotation.", error);
    }
  }

  private async dispatchCommit(session: AnnotationSession, options: CommitOptions): Promise<void> {
    const requestKey = buildCommitKey(session);
    const commitRequest = this.commitRequests.get(requestKey) ?? this.createCommitRequest(session);
    const currentSession = this.stateMachine.getSession();

    if (options.closeOnSuccess && currentSession?.sessionId === session.sessionId) {
      this.stateMachine.setMode(session.sessionId, "committing");
    }

    try {
      const result = await commitRequest;
      this.handleCommitSuccess(session, result, options);
    } catch (error) {
      this.handleCommitFailure(session, error, options);
    }
  }

  private createCommitRequest(session: AnnotationSession): Promise<AnnotationCommitResult> {
    const requestKey = buildCommitKey(session);
    const commitRequest = this.persistence
      .commitSession(session, session.annotationId ? this.store.get(session.annotationId) : null)
      .finally(() => {
        this.commitRequests.delete(requestKey);
      });

    this.commitRequests.set(requestKey, commitRequest);
    return commitRequest;
  }

  private async finalizeEditingSession(options: { reopenOnFailure: boolean }): Promise<void> {
    const activeSession = this.stateMachine.getSession();

    if (!activeSession || (activeSession.mode !== "editing" && activeSession.mode !== "resizing" && activeSession.mode !== "committing")) {
      return;
    }

    this.clearAutosaveTimer();
    await this.dispatchCommit(activeSession, {
      closeOnSuccess: true,
      reopenOnFailure: options.reopenOnFailure
    });
  }

  private handleCanvasPointerDown(
    annotationId: string,
    target: "body" | "resize",
    event: PointerEvent
  ): void {
    if (!this.interactive) {
      return;
    }

    const annotation = this.store.get(annotationId);

    if (!annotation) {
      return;
    }

    const activeSession = this.stateMachine.getSession();

    if (activeSession && activeSession.annotationId !== annotationId) {
      this.beginNextSession(() => {
        this.handleCanvasPointerDown(annotationId, target, event);
      });
      return;
    }

    this.clearAutosaveTimer();
    this.pointerController.clear();

    const nextSession =
      target === "body"
        ? this.stateMachine.startDragging({
            annotationId,
            colorToken: annotation.colorToken,
            content: annotation.content,
            frame: toFrame(annotation),
            pageKey: annotation.pageKey
          })
        : this.stateMachine.startResizing({
            annotationId,
            colorToken: annotation.colorToken,
            content: annotation.content,
            frame: toFrame(annotation),
            pageKey: annotation.pageKey
          });

    this.pointerController.begin({
      event,
      onFinish: ({ hasMoved, sessionId }) => {
        const currentSession = this.stateMachine.getSession();

        if (!currentSession || currentSession.sessionId !== sessionId) {
          return;
        }

        if (!hasMoved) {
          this.stateMachine.clear(sessionId);

          if (target === "body") {
            this.startEditingStoredAnnotation(annotationId);
          } else {
            this.syncStoredAnnotation(annotationId);
          }

          return;
        }

        void this.dispatchCommit(currentSession, {
          closeOnSuccess: true,
          reopenOnFailure: false
        });
      },
      onPreview: (nextFrame) => {
        this.stateMachine.updateFrame(nextSession.sessionId, nextFrame);
        this.canvas.previewAnnotation(annotationId, nextFrame);
      },
      originFrame: toFrame(annotation),
      sessionId: nextSession.sessionId,
      target
    });
  }

  private handleCommitFailure(
    session: AnnotationSession,
    error: unknown,
    options: CommitOptions
  ): void {
    const currentSession = this.stateMachine.getSession();

    if (session.annotationId) {
      this.syncStoredAnnotation(session.annotationId);
    }

    if (isExpectedRuntimeLifecycleError(error)) {
      return;
    }

    if (currentSession?.sessionId === session.sessionId) {
      if (options.reopenOnFailure) {
        this.stateMachine.setMode(session.sessionId, "editing");

        if (currentSession.annotationId) {
          this.canvas.setHiddenAnnotation(currentSession.annotationId);
        }

        this.editor.open(currentSession);
        this.editor.focus();
      } else if (options.closeOnSuccess) {
        this.editor.close();
        this.canvas.setHiddenAnnotation(null);
        this.stateMachine.clear(session.sessionId);
      } else {
        this.stateMachine.setMode(session.sessionId, "editing");
      }
    }

    console.error("WebNote failed to commit the page annotation.", error);
  }

  private handleCommitSuccess(
    session: AnnotationSession,
    result: AnnotationCommitResult,
    options: CommitOptions
  ): void {
    this.applyCommitResult(result);

    const currentSession = this.stateMachine.getSession();

    if (!currentSession || currentSession.sessionId !== session.sessionId) {
      return;
    }

    if (result.kind === "save") {
      const boundSession = this.stateMachine.bindAnnotationId(session.sessionId, result.annotation.id);
      const latestSession = boundSession ?? this.stateMachine.getSession();

      if (latestSession && !options.closeOnSuccess) {
        this.canvas.setHiddenAnnotation(result.annotation.id);
      }
    }

    if (options.closeOnSuccess) {
      this.editor.close();
      this.canvas.setHiddenAnnotation(null);
      this.stateMachine.clear(session.sessionId);
      return;
    }

    this.stateMachine.setMode(session.sessionId, "editing");
  }

  private handleEditorInput(draftText: string): void {
    const activeSession = this.stateMachine.getSession();

    if (!activeSession || (activeSession.mode !== "editing" && activeSession.mode !== "committing")) {
      return;
    }

    const updatedSession = this.stateMachine.updateDraftText(activeSession.sessionId, draftText);

    if (!updatedSession) {
      return;
    }

    this.scheduleAutosave();
  }

  private handleEditorResizePointerDown(event: PointerEvent): void {
    const activeSession = this.stateMachine.getSession();

    if (!activeSession || (activeSession.mode !== "editing" && activeSession.mode !== "committing")) {
      return;
    }

    this.clearAutosaveTimer();
    this.pointerController.clear();
    this.stateMachine.setMode(activeSession.sessionId, "resizing");

    this.pointerController.begin({
      event,
      onFinish: ({ hasMoved, sessionId }) => {
        const currentSession = this.stateMachine.getSession();

        if (!currentSession || currentSession.sessionId !== sessionId) {
          return;
        }

        this.stateMachine.setMode(sessionId, "editing");
        this.editor.focus();

        if (!hasMoved) {
          return;
        }

        void this.dispatchCommit(currentSession, {
          closeOnSuccess: false,
          reopenOnFailure: false
        });
      },
      onPreview: (nextFrame) => {
        this.stateMachine.updateFrame(activeSession.sessionId, nextFrame);
        this.editor.updateFrame(nextFrame);
      },
      originFrame: cloneFrame(activeSession.frame),
      sessionId: activeSession.sessionId,
      target: "editor-resize"
    });
  }

  private async loadPreferredWidth(): Promise<void> {
    const candidateWidth = await this.persistence.loadPreferredWidth();

    if (candidateWidth !== null) {
      this.updatePreferredWidth(candidateWidth);
    }
  }

  private previewActiveSession(session: AnnotationSession): void {
    if (!session.annotationId) {
      return;
    }

    const storedAnnotation = this.store.get(session.annotationId);

    if (!storedAnnotation) {
      return;
    }

    this.canvas.syncAnnotation({
      ...storedAnnotation,
      colorToken: session.colorToken,
      content: session.draftText.trim(),
      width: session.frame.width,
      x: session.frame.x,
      y: session.frame.y
    });
  }

  private resetRuntimeState(): void {
    this.clearAutosaveTimer();
    this.pointerController.clear();
    this.editor.close();
    this.canvas.setHiddenAnnotation(null);
    this.stateMachine.clear();
  }

  private restoreAnnotation(annotation: WebAnnotationEntity): void {
    this.store.upsert(annotation);
    this.canvas.syncAnnotation(annotation);
  }

  private scheduleAutosave(): void {
    const activeSession = this.stateMachine.getSession();

    if (!activeSession || activeSession.draftText.trim().length === 0) {
      this.clearAutosaveTimer();
      return;
    }

    this.clearAutosaveTimer();
    this.autosaveTimer = window.setTimeout(() => {
      this.autosaveTimer = null;
      const currentSession = this.stateMachine.getSession();

      if (!currentSession || currentSession.draftText.trim().length === 0) {
        return;
      }

      void this.dispatchCommit(currentSession, {
        closeOnSuccess: false,
        reopenOnFailure: false
      });
    }, ANNOTATION_AUTOSAVE_DEBOUNCE_MS);
  }

  private startEditingStoredAnnotation(annotationId: string): void {
    const annotation = this.store.get(annotationId);

    if (!annotation) {
      return;
    }

    this.beginNextSession(() => {
      const nextSession = this.stateMachine.startEditing({
        annotationId,
        colorToken: annotation.colorToken,
        content: annotation.content,
        frame: toFrame(annotation),
        pageKey: annotation.pageKey
      });
      this.canvas.setHiddenAnnotation(annotationId);
      this.editor.open(nextSession);
      this.editor.focus();
    });
  }

  private syncStoredAnnotation(annotationId: string): void {
    const annotation = this.store.get(annotationId);

    if (!annotation) {
      this.canvas.removeAnnotation(annotationId);
      return;
    }

    this.canvas.syncAnnotation(annotation);
  }

  private updatePreferredWidth(width: number): void {
    const nextPreferredWidth = Math.max(Math.round(width), ANNOTATION_MIN_WIDTH_PX);

    if (this.preferredWidth === nextPreferredWidth) {
      return;
    }

    this.preferredWidth = nextPreferredWidth;
    this.persistence.persistPreferredWidth(this.preferredWidth);
  }

  private closeSessionIfEditingAnnotation(annotationId: string): void {
    const activeSession = this.stateMachine.getSession();

    if (activeSession?.annotationId !== annotationId) {
      return;
    }

    this.clearAutosaveTimer();
    this.pointerController.clear();
    this.editor.close();
    this.canvas.setHiddenAnnotation(null);
    this.stateMachine.clear(activeSession.sessionId);
  }

  private applyCommitResult(result: AnnotationCommitResult): void {
    if (result.kind === "delete") {
      this.store.remove(result.annotationId);
      this.canvas.removeAnnotation(result.annotationId);
      return;
    }

    if (result.kind !== "save") {
      return;
    }

    this.store.upsert(result.annotation);
    this.canvas.syncAnnotation(result.annotation);
    this.updatePreferredWidth(result.annotation.width);
  }
}
