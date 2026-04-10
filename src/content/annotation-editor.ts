import {
  ANNOTATION_EDITOR_CLASS,
  ANNOTATION_EDITOR_OPEN_CLASS,
  applyAnnotationColor,
  applyAnnotationFrame,
  autosizeAnnotationEditor,
  createEditorInputElement,
  createResizeHandleElement,
  injectAnnotationStyles,
  removeElementSafely,
  type AnnotationFrame
} from "./annotation-dom";
import type { ColorToken } from "../shared/colors";
import type { AnnotationSession } from "./annotation-state-machine";

interface AnnotationEditorHandlers {
  onBlurRequest: () => void;
  onEscape: () => void;
  onInput: (draftText: string) => void;
  onResizePointerDown: (event: PointerEvent) => void;
}

export class AnnotationEditor {
  private readonly editorElement: HTMLTextAreaElement;
  private readonly rootElement: HTMLDivElement;
  private isOpen = false;
  private suppressNextBlur = false;

  constructor(private readonly handlers: AnnotationEditorHandlers) {
    injectAnnotationStyles();
    this.rootElement = document.createElement("div");
    this.rootElement.className = ANNOTATION_EDITOR_CLASS;
    this.rootElement.dataset.webnoteOverlay = "true";
    this.rootElement.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });

    this.editorElement = createEditorInputElement();
    this.editorElement.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    this.editorElement.addEventListener("input", () => {
      autosizeAnnotationEditor(this.editorElement);
      this.handlers.onInput(this.editorElement.value);
    });
    this.editorElement.addEventListener("blur", () => {
      queueMicrotask(() => {
        if (this.suppressNextBlur) {
          this.suppressNextBlur = false;
          return;
        }

        if (!this.isOpen || this.rootElement.contains(document.activeElement)) {
          return;
        }

        this.handlers.onBlurRequest();
      });
    });
    this.editorElement.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      this.handlers.onEscape();
    });

    const resizeHandleElement = createResizeHandleElement();
    resizeHandleElement.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handlers.onResizePointerDown(event);
    });

    this.rootElement.append(this.editorElement, resizeHandleElement);
    document.body.append(this.rootElement);
  }

  close(): void {
    if (!this.isOpen) {
      return;
    }

    this.isOpen = false;
    this.rootElement.classList.remove(ANNOTATION_EDITOR_OPEN_CLASS);

    if (this.rootElement.contains(document.activeElement)) {
      this.suppressNextBlur = true;
      this.editorElement.blur();
    }
  }

  dispose(): void {
    this.close();
    removeElementSafely(this.rootElement);
  }

  focus(): void {
    if (!this.isOpen) {
      return;
    }

    this.editorElement.focus();
    this.editorElement.setSelectionRange(this.editorElement.value.length, this.editorElement.value.length);
  }

  isOwnedTarget(target: EventTarget | null): boolean {
    return target instanceof Node && this.rootElement.contains(target);
  }

  open(session: AnnotationSession): void {
    this.isOpen = true;
    this.rootElement.classList.add(ANNOTATION_EDITOR_OPEN_CLASS);
    this.setColorToken(session.colorToken);
    this.setValue(session.draftText);
    this.updateFrame(session.frame);
    autosizeAnnotationEditor(this.editorElement);
  }

  setColorToken(colorToken: ColorToken): void {
    applyAnnotationColor(this.rootElement, colorToken);
  }

  setValue(draftText: string): void {
    if (this.editorElement.value === draftText) {
      return;
    }

    this.editorElement.value = draftText;
    autosizeAnnotationEditor(this.editorElement);
  }

  updateFrame(frame: AnnotationFrame): void {
    applyAnnotationFrame(this.rootElement, frame);
  }
}
