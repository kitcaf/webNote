import {
  ANNOTATION_CANVAS_CLASS,
  ANNOTATION_CANVAS_INTERACTIVE_CLASS,
  ANNOTATION_CARD_CLASS,
  ANNOTATION_CARD_CONTENT_CLASS,
  ANNOTATION_CARD_DELETE_CLASS,
  ANNOTATION_CARD_GRIP_CLASS,
  ANNOTATION_CARD_HIDDEN_CLASS,
  ANNOTATION_CARD_PREVIEW_CLASS,
  ANNOTATION_RESIZE_HANDLE_CLASS,
  applyAnnotationColor,
  applyAnnotationFrame,
  createResizeHandleElement,
  injectAnnotationStyles,
  removeElementSafely,
  type AnnotationFrame
} from "./annotation-dom";
import {
  ANNOTATION_DELETE_BUTTON_LABEL,
  ANNOTATION_DELETE_BUTTON_TEXT
} from "../shared/constants";
import type { WebAnnotationEntity } from "../shared/types";

type AnnotationPointerTarget = "body" | "resize";

interface AnnotationCanvasHandlers {
  onDelete: (annotationId: string) => void;
  onPointerDown: (annotationId: string, target: AnnotationPointerTarget, event: PointerEvent) => void;
}

interface AnnotationCardView {
  contentElement: HTMLSpanElement;
  rootElement: HTMLDivElement;
}

export class AnnotationCanvas {
  private readonly cardViews = new Map<string, AnnotationCardView>();
  private readonly layer: HTMLDivElement;
  private hiddenAnnotationId: string | null = null;

  constructor(private readonly handlers: AnnotationCanvasHandlers) {
    injectAnnotationStyles();
    this.layer = document.createElement("div");
    this.layer.className = ANNOTATION_CANVAS_CLASS;
    this.layer.dataset.webnoteOverlay = "true";
    document.body.append(this.layer);
  }

  dispose(): void {
    removeElementSafely(this.layer);
    this.cardViews.clear();
    this.hiddenAnnotationId = null;
  }

  isOwnedTarget(target: EventTarget | null): boolean {
    return target instanceof Node && this.layer.contains(target);
  }

  previewAnnotation(annotationId: string, frame: AnnotationFrame): void {
    const cardView = this.cardViews.get(annotationId);

    if (!cardView) {
      return;
    }

    cardView.rootElement.classList.add(ANNOTATION_CARD_PREVIEW_CLASS);
    applyAnnotationFrame(cardView.rootElement, frame);
  }

  removeAnnotation(annotationId: string): void {
    const cardView = this.cardViews.get(annotationId);

    if (!cardView) {
      return;
    }

    if (this.hiddenAnnotationId === annotationId) {
      this.hiddenAnnotationId = null;
    }

    removeElementSafely(cardView.rootElement);
    this.cardViews.delete(annotationId);
  }

  setAnnotations(annotations: Iterable<WebAnnotationEntity>): void {
    const nextAnnotationIds = new Set<string>();

    for (const annotation of annotations) {
      nextAnnotationIds.add(annotation.id);
      this.syncAnnotation(annotation);
    }

    for (const annotationId of [...this.cardViews.keys()]) {
      if (!nextAnnotationIds.has(annotationId)) {
        this.removeAnnotation(annotationId);
      }
    }
  }

  setHiddenAnnotation(annotationId: string | null): void {
    if (this.hiddenAnnotationId === annotationId) {
      return;
    }

    if (this.hiddenAnnotationId) {
      this.cardViews.get(this.hiddenAnnotationId)?.rootElement.classList.remove(ANNOTATION_CARD_HIDDEN_CLASS);
    }

    this.hiddenAnnotationId = annotationId;

    if (annotationId) {
      this.cardViews.get(annotationId)?.rootElement.classList.add(ANNOTATION_CARD_HIDDEN_CLASS);
    }
  }

  setInteractive(interactive: boolean): void {
    this.layer.classList.toggle(ANNOTATION_CANVAS_INTERACTIVE_CLASS, interactive);
  }

  syncAnnotation(annotation: WebAnnotationEntity): void {
    const cardView = this.cardViews.get(annotation.id) ?? this.createCardView(annotation.id);
    cardView.contentElement.textContent = annotation.content;
    cardView.rootElement.classList.remove(ANNOTATION_CARD_PREVIEW_CLASS);
    applyAnnotationColor(cardView.rootElement, annotation.colorToken);
    applyAnnotationFrame(cardView.rootElement, annotation);
    cardView.rootElement.classList.toggle(ANNOTATION_CARD_HIDDEN_CLASS, this.hiddenAnnotationId === annotation.id);
  }

  private createCardView(annotationId: string): AnnotationCardView {
    const rootElement = document.createElement("div");
    rootElement.className = ANNOTATION_CARD_CLASS;
    rootElement.dataset.webnoteOverlay = "true";

    const gripElement = document.createElement("span");
    gripElement.className = ANNOTATION_CARD_GRIP_CLASS;

    const contentElement = document.createElement("span");
    contentElement.className = ANNOTATION_CARD_CONTENT_CLASS;

    const deleteButton = document.createElement("button");
    deleteButton.className = ANNOTATION_CARD_DELETE_CLASS;
    deleteButton.dataset.webnoteOverlay = "true";
    deleteButton.setAttribute("aria-label", ANNOTATION_DELETE_BUTTON_LABEL);
    deleteButton.textContent = ANNOTATION_DELETE_BUTTON_TEXT;
    deleteButton.type = "button";
    deleteButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    deleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handlers.onDelete(annotationId);
    });

    const resizeHandle = createResizeHandleElement();
    resizeHandle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handlers.onPointerDown(annotationId, "resize", event);
    });

    rootElement.append(gripElement, contentElement, deleteButton, resizeHandle);
    rootElement.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }

      if (event.target instanceof Element && event.target.closest(`.${ANNOTATION_RESIZE_HANDLE_CLASS}`)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.handlers.onPointerDown(annotationId, "body", event);
    });

    this.layer.append(rootElement);
    const cardView = {
      contentElement,
      rootElement
    };
    this.cardViews.set(annotationId, cardView);
    return cardView;
  }
}
