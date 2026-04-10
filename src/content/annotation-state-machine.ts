import type { ColorToken } from "../shared/colors";
import type { PageKey } from "../shared/types";
import type { AnnotationFrame } from "./annotation-dom";

export type AnnotationInteractionMode = "idle" | "editing" | "dragging" | "resizing" | "committing";

export interface AnnotationSession {
  annotationId: string | null;
  colorToken: ColorToken;
  draftRevision: number;
  draftText: string;
  frame: AnnotationFrame;
  mode: Exclude<AnnotationInteractionMode, "idle">;
  pageKey: PageKey;
  sessionId: number;
  startedAt: number;
}

const cloneSession = (session: AnnotationSession): AnnotationSession => ({
  ...session,
  frame: { ...session.frame }
});

export class AnnotationStateMachine {
  private activeSession: AnnotationSession | null = null;
  private nextSessionId = 1;

  getSession(): AnnotationSession | null {
    return this.activeSession ? cloneSession(this.activeSession) : null;
  }

  clear(sessionId?: number): void {
    if (!this.activeSession) {
      return;
    }

    if (sessionId !== undefined && this.activeSession.sessionId !== sessionId) {
      return;
    }

    this.activeSession = null;
  }

  openDraft(input: {
    colorToken: ColorToken;
    draftText: string;
    frame: AnnotationFrame;
    pageKey: PageKey;
  }): AnnotationSession {
    return this.replaceSession({
      annotationId: null,
      colorToken: input.colorToken,
      draftText: input.draftText,
      frame: input.frame,
      mode: "editing",
      pageKey: input.pageKey
    });
  }

  startDragging(input: {
    annotationId: string;
    colorToken: ColorToken;
    content: string;
    frame: AnnotationFrame;
    pageKey: PageKey;
  }): AnnotationSession {
    return this.replaceSession({
      annotationId: input.annotationId,
      colorToken: input.colorToken,
      draftText: input.content,
      frame: input.frame,
      mode: "dragging",
      pageKey: input.pageKey
    });
  }

  startEditing(input: {
    annotationId: string;
    colorToken: ColorToken;
    content: string;
    frame: AnnotationFrame;
    pageKey: PageKey;
  }): AnnotationSession {
    return this.replaceSession({
      annotationId: input.annotationId,
      colorToken: input.colorToken,
      draftText: input.content,
      frame: input.frame,
      mode: "editing",
      pageKey: input.pageKey
    });
  }

  startResizing(input: {
    annotationId: string;
    colorToken: ColorToken;
    content: string;
    frame: AnnotationFrame;
    pageKey: PageKey;
  }): AnnotationSession {
    return this.replaceSession({
      annotationId: input.annotationId,
      colorToken: input.colorToken,
      draftText: input.content,
      frame: input.frame,
      mode: "resizing",
      pageKey: input.pageKey
    });
  }

  setMode(sessionId: number, mode: Exclude<AnnotationInteractionMode, "idle">): AnnotationSession | null {
    if (!this.activeSession || this.activeSession.sessionId !== sessionId) {
      return null;
    }

    if (this.activeSession.mode === mode) {
      return cloneSession(this.activeSession);
    }

    this.activeSession = {
      ...this.activeSession,
      mode
    };
    return cloneSession(this.activeSession);
  }

  updateDraftText(sessionId: number, draftText: string): AnnotationSession | null {
    if (!this.activeSession || this.activeSession.sessionId !== sessionId) {
      return null;
    }

    if (this.activeSession.draftText === draftText) {
      return cloneSession(this.activeSession);
    }

    this.activeSession = {
      ...this.activeSession,
      draftRevision: this.activeSession.draftRevision + 1,
      draftText
    };
    return cloneSession(this.activeSession);
  }

  updateFrame(sessionId: number, frame: AnnotationFrame): AnnotationSession | null {
    if (!this.activeSession || this.activeSession.sessionId !== sessionId) {
      return null;
    }

    if (
      this.activeSession.frame.width === frame.width &&
      this.activeSession.frame.x === frame.x &&
      this.activeSession.frame.y === frame.y
    ) {
      return cloneSession(this.activeSession);
    }

    this.activeSession = {
      ...this.activeSession,
      draftRevision: this.activeSession.draftRevision + 1,
      frame: { ...frame }
    };
    return cloneSession(this.activeSession);
  }

  updateColorToken(sessionId: number, colorToken: ColorToken): AnnotationSession | null {
    if (!this.activeSession || this.activeSession.sessionId !== sessionId) {
      return null;
    }

    if (this.activeSession.colorToken === colorToken) {
      return cloneSession(this.activeSession);
    }

    this.activeSession = {
      ...this.activeSession,
      colorToken,
      draftRevision: this.activeSession.draftRevision + 1
    };
    return cloneSession(this.activeSession);
  }

  bindAnnotationId(sessionId: number, annotationId: string): AnnotationSession | null {
    if (!this.activeSession || this.activeSession.sessionId !== sessionId) {
      return null;
    }

    if (this.activeSession.annotationId === annotationId) {
      return cloneSession(this.activeSession);
    }

    this.activeSession = {
      ...this.activeSession,
      annotationId
    };
    return cloneSession(this.activeSession);
  }

  private replaceSession(input: {
    annotationId: string | null;
    colorToken: ColorToken;
    draftText: string;
    frame: AnnotationFrame;
    mode: Exclude<AnnotationInteractionMode, "idle">;
    pageKey: PageKey;
  }): AnnotationSession {
    this.activeSession = {
      annotationId: input.annotationId,
      colorToken: input.colorToken,
      draftRevision: 0,
      draftText: input.draftText,
      frame: { ...input.frame },
      mode: input.mode,
      pageKey: input.pageKey,
      sessionId: this.nextSessionId,
      startedAt: Date.now()
    };
    this.nextSessionId += 1;
    return cloneSession(this.activeSession);
  }
}
