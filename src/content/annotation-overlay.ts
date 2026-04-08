import {
  ANNOTATION_DELETE_BUTTON_LABEL,
  ANNOTATION_DELETE_BUTTON_TEXT,
  ANNOTATION_PLACEHOLDER
} from "../shared/constants";
import type { PageKey, WebAnnotationEntity } from "../shared/types";

interface AnnotationOverlayHandlers {
  onDelete: (annotationId: string) => Promise<void>;
  onSave: (input: {
    annotationId?: string;
    content: string;
    pageKey: PageKey;
    x: number;
    y: number;
  }) => Promise<WebAnnotationEntity>;
}

interface DraftAnnotationState {
  annotationId?: string;
  editorElement: HTMLTextAreaElement;
  x: number;
  y: number;
}

const OVERLAY_STYLE_ID = "webnote-annotation-overlay-style";
const MAX_NOTE_WIDTH_PX = 260;
const MIN_EDITOR_HEIGHT_PX = 26;

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
      cursor: text;
    }

    .webnote-annotation-text,
    .webnote-annotation-editor {
      position: absolute;
      max-width: ${MAX_NOTE_WIDTH_PX}px;
      color: rgba(17, 24, 39, 0.94);
      font: 600 16px/1.55 "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      letter-spacing: 0.01em;
      white-space: pre-wrap;
      word-break: break-word;
      text-shadow: 0 1px 2px rgba(255, 255, 255, 0.88);
    }

    .webnote-annotation-text {
      pointer-events: none;
      user-select: none;
    }

    .webnote-annotation-text__content {
      display: block;
      padding-right: 22px;
    }

    .webnote-annotation-layer--interactive .webnote-annotation-text:hover {
      outline: 1px dashed rgba(37, 99, 235, 0.24);
      outline-offset: 4px;
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

    .webnote-annotation-layer--interactive .webnote-annotation-text:hover .webnote-annotation-text__delete,
    .webnote-annotation-layer--interactive .webnote-annotation-text:focus-within .webnote-annotation-text__delete {
      display: grid;
      place-items: center;
    }

    .webnote-annotation-editor {
      pointer-events: auto;
      outline: 1px dashed rgba(37, 99, 235, 0.3);
      outline-offset: 4px;
    }

    .webnote-annotation-editor__input {
      display: block;
      width: min(${MAX_NOTE_WIDTH_PX}px, calc(100vw - 24px));
      min-height: ${MIN_EDITOR_HEIGHT_PX}px;
      padding: 0;
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
    }

    .webnote-annotation-editor__input::placeholder {
      color: rgba(100, 116, 139, 0.46);
    }
  `;

  document.head.append(styleElement);
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const autosizeEditor = (editorElement: HTMLTextAreaElement): void => {
  editorElement.style.height = "0px";
  editorElement.style.height = `${Math.max(MIN_EDITOR_HEIGHT_PX, editorElement.scrollHeight)}px`;
};

export class AnnotationOverlay {
  private readonly layer: HTMLDivElement;
  private readonly cards = new Map<string, HTMLDivElement>();
  private readonly annotations = new Map<string, WebAnnotationEntity>();
  private currentPageKey: PageKey | null = null;
  private draftState: DraftAnnotationState | null = null;
  private interactive = false;
  private isCommittingDraft = false;

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
  }

  setPageKey(pageKey: PageKey): void {
    this.currentPageKey = pageKey;
  }

  hydrate(annotations: WebAnnotationEntity[]): void {
    this.cancelDraft();

    for (const cardElement of this.cards.values()) {
      cardElement.remove();
    }

    this.cards.clear();
    this.annotations.clear();

    for (const annotation of annotations) {
      this.upsertAnnotation(annotation);
    }
  }

  upsertAnnotation(annotation: WebAnnotationEntity): void {
    this.annotations.set(annotation.id, annotation);
    this.cards.get(annotation.id)?.remove();

    const cardElement = document.createElement("div");
    cardElement.className = "webnote-annotation-text";
    cardElement.dataset.webnoteOverlay = "true";
    cardElement.style.left = `${annotation.x}px`;
    cardElement.style.top = `${annotation.y}px`;
    const contentElement = document.createElement("span");
    contentElement.className = "webnote-annotation-text__content";
    contentElement.textContent = annotation.content;
    const deleteButton = document.createElement("button");
    deleteButton.className = "webnote-annotation-text__delete";
    deleteButton.dataset.webnoteOverlay = "true";
    deleteButton.setAttribute("aria-label", ANNOTATION_DELETE_BUTTON_LABEL);
    deleteButton.textContent = ANNOTATION_DELETE_BUTTON_TEXT;
    deleteButton.type = "button";
    deleteButton.addEventListener("mousedown", (event) => {
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
          console.error("WebNote failed to delete the page annotation.", error);
        });
    });
    cardElement.append(contentElement, deleteButton);
    cardElement.addEventListener("mousedown", (event) => {
      if (!this.interactive) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    });
    cardElement.addEventListener("click", (event) => {
      if (!this.interactive) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.openDraft({
        annotationId: annotation.id,
        content: annotation.content,
        x: annotation.x,
        y: annotation.y
      });
    });

    this.cards.set(annotation.id, cardElement);
    this.layer.append(cardElement);
  }

  removeAnnotation(annotationId: string): void {
    this.annotations.delete(annotationId);
    this.cards.get(annotationId)?.remove();
    this.cards.delete(annotationId);
  }

  openDraftAt(pageX: number, pageY: number): void {
    this.openDraft({
      content: "",
      x: pageX,
      y: pageY
    });
  }

  cancelDraft(): void {
    if (!this.draftState) {
      return;
    }

    if (this.draftState.annotationId) {
      const existingAnnotation = this.annotations.get(this.draftState.annotationId);

      if (existingAnnotation) {
        this.upsertAnnotation(existingAnnotation);
      }
    }

    this.teardownDraftEditor();
  }

  private openDraft(input: {
    annotationId?: string;
    content: string;
    x: number;
    y: number;
  }): void {
    if (!this.currentPageKey) {
      return;
    }

    this.cancelDraft();

    const x = clamp(
      input.x,
      window.scrollX + 10,
      Math.max(window.scrollX + 10, window.scrollX + window.innerWidth - MAX_NOTE_WIDTH_PX - 10)
    );
    const y = Math.max(window.scrollY + 8, input.y);
    const wrapperElement = document.createElement("div");
    wrapperElement.className = "webnote-annotation-editor";
    wrapperElement.dataset.webnoteOverlay = "true";
    wrapperElement.style.left = `${x}px`;
    wrapperElement.style.top = `${y}px`;

    const editorElement = document.createElement("textarea");
    editorElement.className = "webnote-annotation-editor__input";
    editorElement.placeholder = ANNOTATION_PLACEHOLDER;
    editorElement.spellcheck = false;
    editorElement.value = input.content;
    editorElement.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });
    editorElement.addEventListener("input", () => {
      autosizeEditor(editorElement);
    });
    editorElement.addEventListener("blur", () => {
      void this.commitDraft();
    });
    editorElement.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      this.cancelDraft();
    });

    wrapperElement.append(editorElement);
    this.layer.append(wrapperElement);
    this.draftState = {
      annotationId: input.annotationId,
      editorElement,
      x,
      y
    };

    if (input.annotationId) {
      this.cards.get(input.annotationId)?.remove();
      this.cards.delete(input.annotationId);
    }

    autosizeEditor(editorElement);
    editorElement.focus();
    editorElement.setSelectionRange(editorElement.value.length, editorElement.value.length);
  }

  private async commitDraft(): Promise<void> {
    if (!this.currentPageKey || !this.draftState || this.isCommittingDraft) {
      return;
    }

    this.isCommittingDraft = true;
    const draftState = this.draftState;
    const nextContent = draftState.editorElement.value.trim();

    try {
      if (!nextContent) {
        if (draftState.annotationId) {
          await this.handlers.onDelete(draftState.annotationId);
          this.removeAnnotation(draftState.annotationId);
        }

        this.teardownDraftEditor();
        return;
      }

      const savedAnnotation = await this.handlers.onSave({
        annotationId: draftState.annotationId,
        content: nextContent,
        pageKey: this.currentPageKey,
        x: draftState.x,
        y: draftState.y
      });

      this.teardownDraftEditor();
      this.upsertAnnotation(savedAnnotation);
    } catch (error) {
      console.error("WebNote failed to commit the page annotation.", error);

      if (draftState.annotationId) {
        const existingAnnotation = this.annotations.get(draftState.annotationId);

        if (existingAnnotation) {
          this.upsertAnnotation(existingAnnotation);
        }
      }

      this.teardownDraftEditor();
    } finally {
      this.isCommittingDraft = false;
    }
  }

  private teardownDraftEditor(): void {
    if (!this.draftState) {
      return;
    }

    const editorWrapper = this.draftState.editorElement.parentElement;
    editorWrapper?.remove();
    this.draftState = null;
  }
}
