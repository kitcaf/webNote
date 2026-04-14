import { ANNOTATION_DRAG_THRESHOLD_PX } from "../shared/constants";
import {
  ANNOTATION_CURSOR_CLASS,
  constrainInteractiveAnnotationFrame,
  type AnnotationFrame
} from "./annotation-dom";

export type AnnotationPointerTarget = "body" | "resize" | "editor-resize";

interface AnnotationPointerSession {
  cleanup: () => void;
  hasMoved: boolean;
  originFrame: AnnotationFrame;
  pointerId: number;
  sessionId: number;
  startClientX: number;
  startClientY: number;
  target: AnnotationPointerTarget;
}

interface BeginAnnotationPointerInteractionOptions {
  event: PointerEvent;
  originFrame: AnnotationFrame;
  sessionId: number;
  target: AnnotationPointerTarget;
  onFinish: (input: { hasMoved: boolean; sessionId: number }) => void;
  onPreview: (frame: AnnotationFrame) => void;
}

export class AnnotationPointerController {
  private activeSession: AnnotationPointerSession | null = null;

  begin(options: BeginAnnotationPointerInteractionOptions): void {
    this.clear();
    this.setInteractionCursor(true);

    const handlePointerMove = (event: PointerEvent): void => {
      const activeSession = this.activeSession;

      if (!activeSession || event.pointerId !== activeSession.pointerId) {
        return;
      }

      event.preventDefault();
      const deltaX = event.clientX - activeSession.startClientX;
      const deltaY = event.clientY - activeSession.startClientY;
      const movement =
        activeSession.target === "body"
          ? Math.max(Math.abs(deltaX), Math.abs(deltaY))
          : Math.abs(deltaX);

      if (!activeSession.hasMoved && movement >= ANNOTATION_DRAG_THRESHOLD_PX) {
        activeSession.hasMoved = true;
      }

      if (!activeSession.hasMoved) {
        return;
      }

      const nextFrame = constrainInteractiveAnnotationFrame(
        activeSession.target === "body"
          ? {
              width: activeSession.originFrame.width,
              x: activeSession.originFrame.x + deltaX,
              y: activeSession.originFrame.y + deltaY
            }
          : {
              width: activeSession.originFrame.width + deltaX,
              x: activeSession.originFrame.x,
              y: activeSession.originFrame.y
            }
      );

      options.onPreview(nextFrame);
    };

    const finishInteraction = (event?: PointerEvent): void => {
      const activeSession = this.activeSession;

      if (!activeSession) {
        return;
      }

      if (event && event.pointerId !== activeSession.pointerId) {
        return;
      }

      const didMove = activeSession.hasMoved;
      const sessionId = activeSession.sessionId;
      this.clear();
      options.onFinish({
        hasMoved: didMove,
        sessionId
      });
    };

    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", finishInteraction, true);
    window.addEventListener("pointercancel", finishInteraction, true);

    this.activeSession = {
      cleanup: () => {
        window.removeEventListener("pointermove", handlePointerMove, true);
        window.removeEventListener("pointerup", finishInteraction, true);
        window.removeEventListener("pointercancel", finishInteraction, true);
        this.setInteractionCursor(false);
      },
      hasMoved: false,
      originFrame: options.originFrame,
      pointerId: options.event.pointerId,
      sessionId: options.sessionId,
      startClientX: options.event.clientX,
      startClientY: options.event.clientY,
      target: options.target
    };
  }

  clear(): void {
    this.activeSession?.cleanup();
    this.activeSession = null;
  }

  isActive(): boolean {
    return this.activeSession !== null;
  }

  private setInteractionCursor(enabled: boolean): void {
    document.documentElement.classList.toggle(ANNOTATION_CURSOR_CLASS, enabled);
  }
}
