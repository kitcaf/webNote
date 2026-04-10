import {
  ANNOTATION_AUTOSAVE_DEBOUNCE_MS,
  ANNOTATION_DEFAULT_WIDTH_PX,
  ANNOTATION_DELETE_BUTTON_LABEL,
  ANNOTATION_DELETE_BUTTON_TEXT,
  ANNOTATION_DRAG_THRESHOLD_PX,
  ANNOTATION_MIN_WIDTH_PX,
  ANNOTATION_PLACEHOLDER,
  ANNOTATION_RESIZE_HANDLE_SIZE_PX
} from "../shared/constants";
import type { PageKey, WebAnnotationEntity } from "../shared/types";
import { isExpectedRuntimeLifecycleError } from "./runtime-errors";

interface AnnotationOverlayHandlers {
  onDelete: (annotationId: string) => Promise<void>;
  onSave: (input: {
    annotationId?: string;
    content: string;
    pageKey: PageKey;
    width: number;
    x: number;
    y: number;
  }) => Promise<WebAnnotationEntity>;
}

interface DraftAnnotationState {
  annotationId?: string;
  autosaveTimer: number | null;
  editorElement: HTMLTextAreaElement;
  width: number;
  wrapperElement: HTMLDivElement;
  x: number;
  y: number;
}

interface PointerInteractionState {
  annotationId: string;
  cleanup: () => void;
  hasMoved: boolean;
  mode: "drag" | "resize" | "draft-resize";
  originWidth: number;
  originX: number;
  originY: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
}

const OVERLAY_STYLE_ID = "webnote-annotation-overlay-style";
const MIN_EDITOR_HEIGHT_PX = 26;
const ANNOTATION_EDGE_PADDING_PX = 10;
const ANNOTATION_TOP_PADDING_PX = 8;
const ANNOTATION_INTERACTION_CURSOR_CLASS = "webnote-annotation-layer--interacting";

const injectOverlayStyles = (): void => {
  if (document.getElementById(OVERLAY_STYLE_ID)) {
    return;
  }

  const styleElement = document.createElement("style");
  styleElement.dataset.webnoteOverlay = "true";
  styleElement.id = OVERLAY_STYLE_ID;
  styleElement.textContent = `
    .webnote-annotation-layer {
      position: absolute;
      inset: 0;
      z-index: 2147483645;
      pointer-events: none;
    }

    .webnote-annotation-layer--interactive .webnote-annotation-text {
      pointer-events: auto;
      cursor: grab;
    }

    .webnote-annotation-layer--interacting {
      cursor: grabbing;
      user-select: none;
    }

    .webnote-annotation-text,
    .webnote-annotation-editor {
      position: absolute;
      min-width: ${ANNOTATION_MIN_WIDTH_PX}px;
      color: rgba(17, 24, 39, 0.94);
      font: 600 16px/1.55 "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      letter-spacing: 0.01em;
      white-space: pre-wrap;
      word-break: break-word;
      text-shadow: 0 1px 2px rgba(255, 255, 255, 0.88);
      transition: box-shadow 140ms ease, outline-color 140ms ease, transform 140ms ease;
    }

    .webnote-annotation-text {
      pointer-events: none;
      user-select: none;
      border-radius: 12px;
    }

    .webnote-annotation-text__content {
      display: block;
      min-height: ${MIN_EDITOR_HEIGHT_PX}px;
      padding: 8px ${ANNOTATION_RESIZE_HANDLE_SIZE_PX + 16}px ${ANNOTATION_RESIZE_HANDLE_SIZE_PX + 12}px 12px;
      border-radius: inherit;
      background: transparent;
    }

    .webnote-annotation-layer--interactive .webnote-annotation-text:hover {
      outline: 1px dashed rgba(37, 99, 235, 0.32);
      outline-offset: 4px;
      transform: translateY(-1px);
    }

    .webnote-annotation-text__delete {
      position: absolute;
      top: -8px;
      right: -8px;
      display: none;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.8);
      color: #ffffff;
      font: 700 11px/1 Inter, "Segoe UI", sans-serif;
      cursor: pointer;
      pointer-events: auto;
    }

    .webnote-annotation-text__grip {
      position: absolute;
      left: -4px;
      top: -8px;
      display: none;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 6px 16px rgba(15, 23, 42, 0.12);
      color: rgba(71, 85, 105, 0.9);
      font: 600 11px/1 Inter, "Segoe UI", sans-serif;
      letter-spacing: 0.02em;
      pointer-events: none;
    }

    .webnote-annotation-text__grip::before {
      content: "";
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background:
        radial-gradient(circle, currentColor 1.2px, transparent 1.2px) 0 0 / 5px 5px;
      opacity: 0.7;
    }

    .webnote-annotation-resize-handle {
      position: absolute;
      right: -4px;
      bottom: -4px;
      display: none;
      width: ${ANNOTATION_RESIZE_HANDLE_SIZE_PX}px;
      height: ${ANNOTATION_RESIZE_HANDLE_SIZE_PX}px;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: rgba(37, 99, 235, 0.9);
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9);
      cursor: ew-resize;
      pointer-events: auto;
      transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
      opacity: 0.94;
    }

    .webnote-annotation-layer--interactive .webnote-annotation-text:hover .webnote-annotation-text__delete,
    .webnote-annotation-layer--interactive .webnote-annotation-text:focus-within .webnote-annotation-text__delete,
    .webnote-annotation-layer--interactive .webnote-annotation-text:hover .webnote-annotation-text__grip,
    .webnote-annotation-layer--interactive .webnote-annotation-text:focus-within .webnote-annotation-text__grip,
    .webnote-annotation-layer--interactive .webnote-annotation-text:hover .webnote-annotation-resize-handle,
    .webnote-annotation-layer--interactive .webnote-annotation-text:focus-within .webnote-annotation-resize-handle {
      display: grid;
      place-items: center;
    }

    .webnote-annotation-layer--interactive .webnote-annotation-text:hover .webnote-annotation-resize-handle,
    .webnote-annotation-editor .webnote-annotation-resize-handle:hover {
      transform: scale(1.08);
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.92), 0 6px 14px rgba(37, 99, 235, 0.3);
    }

    .webnote-annotation-editor {
      pointer-events: auto;
      outline: 1px dashed rgba(37, 99, 235, 0.3);
      outline-offset: 4px;
      border-radius: 12px;
      background: transparent;
    }

    .webnote-annotation-editor__input {
      display: block;
      width: 100%;
      min-height: ${MIN_EDITOR_HEIGHT_PX}px;
      padding: 8px ${ANNOTATION_RESIZE_HANDLE_SIZE_PX + 16}px ${ANNOTATION_RESIZE_HANDLE_SIZE_PX + 12}px 12px;
      border: 0;
      outline: 0;
      resize: none;
      overflow: hidden;
      background: transparent;
      color: rgba(17, 24, 39, 0.94);
      caret-color: #2563eb;
      font: inherit;
      line-height: inherit;
      letter-spacing: inherit;
      box-sizing: border-box;
    }

    .webnote-annotation-editor__input::placeholder {
      color: rgba(100, 116, 139, 0.46);
    }

    .webnote-annotation-editor .webnote-annotation-resize-handle {
      display: grid;
      place-items: center;
    }
  `;

  document.head.append(styleElement);
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const clampAnnotationWidth = (width: number): number =>
  Math.max(Math.round(width), ANNOTATION_MIN_WIDTH_PX);

const clampAnnotationX = (x: number, width: number): number =>
  Math.max(window.scrollX + ANNOTATION_EDGE_PADDING_PX, Math.round(x));

const clampAnnotationY = (y: number): number => Math.max(window.scrollY + ANNOTATION_TOP_PADDING_PX, Math.round(y));

const applyFrameRect = (
  element: HTMLElement,
  input: {
    width: number;
    x: number;
    y: number;
  }
): {
  width: number;
  x: number;
  y: number;
} => {
  const width = clampAnnotationWidth(input.width);
  const x = clampAnnotationX(input.x, width);
  const y = clampAnnotationY(input.y);
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.style.width = `${width}px`;

  return {
    width,
    x,
    y
  };
};

const autosizeEditor = (editorElement: HTMLTextAreaElement): void => {
  editorElement.style.height = "0px";
  editorElement.style.height = `${Math.max(MIN_EDITOR_HEIGHT_PX, editorElement.scrollHeight)}px`;
};

const safeRemoveElement = (element: Element | null | undefined): void => {
  if (!element) {
    return;
  }

  element.remove();
};

const createResizeHandleElement = (): HTMLButtonElement => {
  const handleElement = document.createElement("button");
  handleElement.className = "webnote-annotation-resize-handle";
  handleElement.dataset.webnoteOverlay = "true";
  handleElement.type = "button";
  handleElement.tabIndex = -1;
  handleElement.setAttribute("aria-label", "Resize annotation");
  return handleElement;
};

export class AnnotationOverlay {
  private readonly layer: HTMLDivElement;
  private readonly cards = new Map<string, HTMLDivElement>();
  private readonly annotations = new Map<string, WebAnnotationEntity>();
  private activePointerInteraction: PointerInteractionState | null = null;
  private currentPageKey: PageKey | null = null;
  private draftState: DraftAnnotationState | null = null;
  private interactive = false;
  private isCommittingDraft = false;
  private preferredDraftWidth = ANNOTATION_DEFAULT_WIDTH_PX;
  private shouldFinalizeDraftAfterCommit = false;

  constructor(private readonly handlers: AnnotationOverlayHandlers) {
    injectOverlayStyles();

    this.layer = document.createElement("div");
    this.layer.className = "webnote-annotation-layer";
    this.layer.dataset.webnoteOverlay = "true";
    document.body.append(this.layer);
  }

  isOwnedTarget(target: EventTarget | null): boolean {
    return target instanceof Node && this.layer.contains(target);
  }

  setInteractive(interactive: boolean): void {
    this.interactive = interactive;
    this.layer.classList.toggle("webnote-annotation-layer--interactive", interactive);

    if (!interactive) {
      this.clearPointerInteraction();
    }
  }

  setPageKey(pageKey: PageKey): void {
    this.currentPageKey = pageKey;
  }

  setPreferredDraftWidth(width: number): void {
    this.preferredDraftWidth = clampAnnotationWidth(width);
  }

  hydrate(annotations: WebAnnotationEntity[]): void {
    this.clearPointerInteraction();
    this.cancelDraft();

    for (const cardElement of this.cards.values()) {
      safeRemoveElement(cardElement);
    }

    this.cards.clear();
    this.annotations.clear();

    for (const annotation of annotations) {
      this.upsertAnnotation(annotation);
    }
  }

  upsertAnnotation(annotation: WebAnnotationEntity): void {
    this.annotations.set(annotation.id, annotation);
    safeRemoveElement(this.cards.get(annotation.id));

    const cardElement = document.createElement("div");
    cardElement.className = "webnote-annotation-text";
    cardElement.dataset.webnoteOverlay = "true";
    applyFrameRect(cardElement, annotation);

    const gripElement = document.createElement("span");
    gripElement.className = "webnote-annotation-text__grip";
    // gripElement.textContent = "Drag";
    const contentElement = document.createElement("span");
    contentElement.className = "webnote-annotation-text__content";
    contentElement.textContent = annotation.content;

    const deleteButton = document.createElement("button");
    deleteButton.className = "webnote-annotation-text__delete";
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
      void this.handlers.onDelete(annotation.id)
        .then(() => {
          this.removeAnnotation(annotation.id);
        })
        .catch((error) => {
          if (isExpectedRuntimeLifecycleError(error)) {
            return;
          }

          console.error("WebNote failed to delete the page annotation.", error);
        });
    });

    const resizeHandle = createResizeHandleElement();
    resizeHandle.addEventListener("pointerdown", (event) => {
      if (!this.interactive) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.beginCardPointerInteraction(annotation.id, "resize", event, cardElement);
    });

    cardElement.append(gripElement, contentElement, deleteButton, resizeHandle);
    cardElement.addEventListener("pointerdown", (event) => {
      if (!this.interactive || event.button !== 0) {
        return;
      }

      if (event.target instanceof Element && event.target.closest(".webnote-annotation-resize-handle")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.beginCardPointerInteraction(annotation.id, "drag", event, cardElement);
    });

    this.cards.set(annotation.id, cardElement);
    this.layer.append(cardElement);
  }

  removeAnnotation(annotationId: string): void {
    if (this.activePointerInteraction?.annotationId === annotationId) {
      this.clearPointerInteraction();
    }

    this.annotations.delete(annotationId);
    safeRemoveElement(this.cards.get(annotationId));
    this.cards.delete(annotationId);
  }

  openDraftAt(pageX: number, pageY: number, preferredWidth = this.preferredDraftWidth): void {
    this.openDraft({
      content: "",
      width: preferredWidth,
      x: pageX,
      y: pageY
    });
  }

  cancelDraft(): void {
    if (!this.draftState) {
      return;
    }

    this.clearAutosaveTimer(this.draftState);

    if (this.draftState.annotationId) {
      const existingAnnotation = this.annotations.get(this.draftState.annotationId);

      if (existingAnnotation) {
        this.upsertAnnotation(existingAnnotation);
      }
    }

    this.teardownDraftEditor();
  }

  async flushDraft(): Promise<void> {
    await this.commitDraft({
      preserveEditor: false
    });
  }

  private clearPointerInteraction(): void {
    this.activePointerInteraction?.cleanup();
    this.activePointerInteraction = null;
  }

  private setInteractionCursor(interacting: boolean): void {
    document.documentElement.classList.toggle(ANNOTATION_INTERACTION_CURSOR_CLASS, interacting);
  }

  private beginCardPointerInteraction(
    annotationId: string,
    mode: "drag" | "resize",
    pointerEvent: PointerEvent,
    cardElement: HTMLDivElement
  ): void {
    const annotation = this.annotations.get(annotationId);

    if (!annotation) {
      return;
    }

    this.clearPointerInteraction();
    this.setInteractionCursor(true);

    const handlePointerMove = (event: PointerEvent): void => {
      if (!this.activePointerInteraction || event.pointerId !== this.activePointerInteraction.pointerId) {
        return;
      }

      event.preventDefault();
      const deltaX = event.clientX - this.activePointerInteraction.startClientX;
      const deltaY = event.clientY - this.activePointerInteraction.startClientY;

      if (
        !this.activePointerInteraction.hasMoved &&
        Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= ANNOTATION_DRAG_THRESHOLD_PX
      ) {
        this.activePointerInteraction.hasMoved = true;
      }

      if (!this.activePointerInteraction.hasMoved) {
        return;
      }

      if (this.activePointerInteraction.mode === "drag") {
        applyFrameRect(cardElement, {
          width: this.activePointerInteraction.originWidth,
          x: this.activePointerInteraction.originX + deltaX,
          y: this.activePointerInteraction.originY + deltaY
        });
        return;
      }

      applyFrameRect(cardElement, {
        width: this.activePointerInteraction.originWidth + deltaX,
        x: this.activePointerInteraction.originX,
        y: this.activePointerInteraction.originY
      });
    };

    const finalizeInteraction = (event: PointerEvent | null): void => {
      const interaction = this.activePointerInteraction;

      if (!interaction) {
        return;
      }

      if (event && event.pointerId !== interaction.pointerId) {
        return;
      }

      const nextRect = {
        width: Number.parseFloat(cardElement.style.width) || annotation.width,
        x: Number.parseFloat(cardElement.style.left) || annotation.x,
        y: Number.parseFloat(cardElement.style.top) || annotation.y
      };
      this.clearPointerInteraction();

      if (!interaction.hasMoved) {
        this.openDraft({
          annotationId,
          content: annotation.content,
          width: annotation.width,
          x: annotation.x,
          y: annotation.y
        });
        return;
      }

      void this.persistAnnotationLayout(annotationId, nextRect);
    };

    const handlePointerUp = (event: PointerEvent): void => {
      finalizeInteraction(event);
    };

    const handlePointerCancel = (event: PointerEvent): void => {
      finalizeInteraction(event);
    };

    const cleanup = (): void => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      cardElement.classList.remove("webnote-annotation-text--dragging");
      this.setInteractionCursor(false);
    };

    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    cardElement.classList.add("webnote-annotation-text--dragging");

    this.activePointerInteraction = {
      annotationId,
      cleanup,
      hasMoved: false,
      mode,
      originWidth: annotation.width,
      originX: annotation.x,
      originY: annotation.y,
      pointerId: pointerEvent.pointerId,
      startClientX: pointerEvent.clientX,
      startClientY: pointerEvent.clientY
    };
  }

  private beginDraftResize(pointerEvent: PointerEvent): void {
    if (!this.draftState) {
      return;
    }

    this.clearPointerInteraction();
    this.setInteractionCursor(true);
    const draftState = this.draftState;

    const handlePointerMove = (event: PointerEvent): void => {
      if (!this.activePointerInteraction || event.pointerId !== this.activePointerInteraction.pointerId) {
        return;
      }

      event.preventDefault();
      const deltaX = event.clientX - this.activePointerInteraction.startClientX;

      if (
        !this.activePointerInteraction.hasMoved &&
        Math.abs(deltaX) >= ANNOTATION_DRAG_THRESHOLD_PX
      ) {
        this.activePointerInteraction.hasMoved = true;
      }

      if (!this.activePointerInteraction.hasMoved || !this.draftState || this.draftState !== draftState) {
        return;
      }

      const nextRect = applyFrameRect(draftState.wrapperElement, {
        width: this.activePointerInteraction.originWidth + deltaX,
        x: this.activePointerInteraction.originX,
        y: this.activePointerInteraction.originY
      });
      this.draftState.width = nextRect.width;
      this.draftState.x = nextRect.x;
      this.draftState.y = nextRect.y;
      autosizeEditor(this.draftState.editorElement);
    };

    const finishResize = (event: PointerEvent | null): void => {
      const interaction = this.activePointerInteraction;

      if (!interaction) {
        return;
      }

      if (event && event.pointerId !== interaction.pointerId) {
        return;
      }

      this.clearPointerInteraction();
    };

    const handlePointerUp = (event: PointerEvent): void => {
      finishResize(event);
    };

    const handlePointerCancel = (event: PointerEvent): void => {
      finishResize(event);
    };

    const cleanup = (): void => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      this.setInteractionCursor(false);
    };

    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);

    this.activePointerInteraction = {
      annotationId: draftState.annotationId ?? "__draft__",
      cleanup,
      hasMoved: false,
      mode: "draft-resize",
      originWidth: draftState.width,
      originX: draftState.x,
      originY: draftState.y,
      pointerId: pointerEvent.pointerId,
      startClientX: pointerEvent.clientX,
      startClientY: pointerEvent.clientY
    };
  }

  private async persistAnnotationLayout(
    annotationId: string,
    input: {
      width: number;
      x: number;
      y: number;
    }
  ): Promise<void> {
    const annotation = this.annotations.get(annotationId);

    if (!annotation) {
      return;
    }

    const nextRect = {
      width: clampAnnotationWidth(input.width),
      x: clampAnnotationX(input.x, input.width),
      y: clampAnnotationY(input.y)
    };

    try {
      const savedAnnotation = await this.handlers.onSave({
        annotationId,
        content: annotation.content,
        pageKey: annotation.pageKey,
        width: nextRect.width,
        x: nextRect.x,
        y: nextRect.y
      });
      this.annotations.set(savedAnnotation.id, savedAnnotation);
      this.upsertAnnotation(savedAnnotation);
    } catch (error) {
      if (isExpectedRuntimeLifecycleError(error)) {
        return;
      }

      console.error("WebNote failed to persist the annotation layout.", error);
      this.upsertAnnotation(annotation);
    }
  }

  private openDraft(input: {
    annotationId?: string;
    content: string;
    width: number;
    x: number;
    y: number;
  }): void {
    if (!this.currentPageKey) {
      return;
    }

    this.clearPointerInteraction();
    this.cancelDraft();

    const wrapperElement = document.createElement("div");
    wrapperElement.className = "webnote-annotation-editor";
    wrapperElement.dataset.webnoteOverlay = "true";
    const nextRect = applyFrameRect(wrapperElement, input);

    const editorElement = document.createElement("textarea");
    editorElement.className = "webnote-annotation-editor__input";
    editorElement.placeholder = ANNOTATION_PLACEHOLDER;
    editorElement.spellcheck = false;
    editorElement.value = input.content;
    editorElement.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    editorElement.addEventListener("input", () => {
      autosizeEditor(editorElement);
      this.scheduleAutosave();
    });
    editorElement.addEventListener("blur", () => {
      void this.commitDraft({
        preserveEditor: false
      });
    });
    editorElement.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      this.cancelDraft();
    });

    const resizeHandle = createResizeHandleElement();
    resizeHandle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.beginDraftResize(event);
    });

    wrapperElement.append(editorElement, resizeHandle);
    this.layer.append(wrapperElement);
    this.draftState = {
      annotationId: input.annotationId,
      autosaveTimer: null,
      editorElement,
      width: nextRect.width,
      wrapperElement,
      x: nextRect.x,
      y: nextRect.y
    };

    if (input.annotationId) {
      safeRemoveElement(this.cards.get(input.annotationId));
      this.cards.delete(input.annotationId);
    }

    autosizeEditor(editorElement);
    editorElement.focus();
    editorElement.setSelectionRange(editorElement.value.length, editorElement.value.length);
  }

  private clearAutosaveTimer(draftState: DraftAnnotationState): void {
    if (draftState.autosaveTimer === null) {
      return;
    }

    window.clearTimeout(draftState.autosaveTimer);
    draftState.autosaveTimer = null;
  }

  private scheduleAutosave(): void {
    if (!this.draftState) {
      return;
    }

    this.clearAutosaveTimer(this.draftState);

    if (this.draftState.editorElement.value.trim().length === 0) {
      return;
    }

    this.draftState.autosaveTimer = window.setTimeout(() => {
      if (!this.draftState) {
        return;
      }

      this.draftState.autosaveTimer = null;
      void this.commitDraft({
        preserveEditor: true
      });
    }, ANNOTATION_AUTOSAVE_DEBOUNCE_MS);
  }

  private async commitDraft(options: {
    preserveEditor: boolean;
  }): Promise<void> {
    if (!this.currentPageKey || !this.draftState) {
      return;
    }

    if (this.isCommittingDraft) {
      if (!options.preserveEditor) {
        this.shouldFinalizeDraftAfterCommit = true;
      }

      return;
    }

    this.isCommittingDraft = true;
    this.shouldFinalizeDraftAfterCommit = false;
    const draftState = this.draftState;
    const nextContent = draftState.editorElement.value.trim();
    this.clearAutosaveTimer(draftState);

    try {
      if (!nextContent) {
        if (draftState.annotationId && !options.preserveEditor) {
          await this.handlers.onDelete(draftState.annotationId);
          this.removeAnnotation(draftState.annotationId);
        }

        if (!options.preserveEditor) {
          this.teardownDraftEditor();
        }

        return;
      }

      const savedAnnotation = await this.handlers.onSave({
        annotationId: draftState.annotationId,
        content: nextContent,
        pageKey: this.currentPageKey,
        width: draftState.width,
        x: draftState.x,
        y: draftState.y
      });

      this.annotations.set(savedAnnotation.id, savedAnnotation);

      if (this.draftState === draftState) {
        this.draftState.annotationId = savedAnnotation.id;
        this.draftState.width = savedAnnotation.width;
        this.draftState.x = savedAnnotation.x;
        this.draftState.y = savedAnnotation.y;
      }

      if (!options.preserveEditor) {
        this.teardownDraftEditor();
        this.upsertAnnotation(savedAnnotation);
      }
    } catch (error) {
      if (!isExpectedRuntimeLifecycleError(error)) {
        console.error("WebNote failed to commit the page annotation.", error);
      }

      if (!options.preserveEditor && draftState.annotationId) {
        const existingAnnotation = this.annotations.get(draftState.annotationId);

        if (existingAnnotation) {
          this.upsertAnnotation(existingAnnotation);
        }
      }

      if (!options.preserveEditor) {
        this.teardownDraftEditor();
      }
    } finally {
      this.isCommittingDraft = false;

      if (this.shouldFinalizeDraftAfterCommit) {
        this.shouldFinalizeDraftAfterCommit = false;
        void this.commitDraft({
          preserveEditor: false
        });
      }
    }
  }

  private teardownDraftEditor(): void {
    if (!this.draftState) {
      return;
    }

    this.clearPointerInteraction();
    this.clearAutosaveTimer(this.draftState);
    safeRemoveElement(this.draftState.wrapperElement);
    this.draftState = null;
  }
}
