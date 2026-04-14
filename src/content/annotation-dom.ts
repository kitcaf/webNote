import {
  ANNOTATION_MIN_WIDTH_PX,
  ANNOTATION_PLACEHOLDER,
  ANNOTATION_RESIZE_HANDLE_SIZE_PX
} from "../shared/constants";
import {
  DEFAULT_ANNOTATION_COLOR_TOKEN,
  getColorPaletteEntry,
  normalizeColorToken,
  type ColorToken
} from "../shared/colors";

export interface AnnotationFrame {
  width: number;
  x: number;
  y: number;
}

const STYLE_ID = "webnote-annotation-overlay-style";
const MIN_EDITOR_HEIGHT_PX = 26;
const EDGE_PADDING_PX = 10;
const TOP_PADDING_PX = 8;
const DEFAULT_ANNOTATION_COLORS = getColorPaletteEntry(DEFAULT_ANNOTATION_COLOR_TOKEN).annotation;

export const ANNOTATION_CURSOR_CLASS = "webnote-annotation-layer--interacting";
export const ANNOTATION_CANVAS_CLASS = "webnote-annotation-canvas";
export const ANNOTATION_CANVAS_INTERACTIVE_CLASS = "webnote-annotation-canvas--interactive";
export const ANNOTATION_CARD_CLASS = "webnote-annotation-card";
export const ANNOTATION_CARD_HIDDEN_CLASS = "webnote-annotation-card--hidden";
export const ANNOTATION_CARD_PREVIEW_CLASS = "webnote-annotation-card--preview";
export const ANNOTATION_CARD_CONTENT_CLASS = "webnote-annotation-card__content";
export const ANNOTATION_CARD_DELETE_CLASS = "webnote-annotation-card__delete";
export const ANNOTATION_CARD_GRIP_CLASS = "webnote-annotation-card__grip";
export const ANNOTATION_EDITOR_CLASS = "webnote-annotation-editor";
export const ANNOTATION_EDITOR_OPEN_CLASS = "webnote-annotation-editor--open";
export const ANNOTATION_EDITOR_INPUT_CLASS = "webnote-annotation-editor__input";
export const ANNOTATION_RESIZE_HANDLE_CLASS = "webnote-annotation-resize-handle";

export const injectAnnotationStyles = (): void => {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const styleElement = document.createElement("style");
  styleElement.dataset.webnoteOverlay = "true";
  styleElement.id = STYLE_ID;
  styleElement.textContent = `
    html.${ANNOTATION_CURSOR_CLASS},
    html.${ANNOTATION_CURSOR_CLASS} body {
      cursor: grabbing;
      user-select: none;
    }

    .${ANNOTATION_CANVAS_CLASS} {
      position: absolute;
      inset: 0;
      z-index: 2147483645;
      pointer-events: none;
    }

    .${ANNOTATION_CANVAS_INTERACTIVE_CLASS} .${ANNOTATION_CARD_CLASS} {
      pointer-events: auto;
      cursor: grab;
    }

    .${ANNOTATION_CARD_CLASS},
    .${ANNOTATION_EDITOR_CLASS} {
      --webnote-annotation-accent-color: ${DEFAULT_ANNOTATION_COLORS.accent};
      --webnote-annotation-text-color: ${DEFAULT_ANNOTATION_COLORS.text};
      position: absolute;
      min-width: ${ANNOTATION_MIN_WIDTH_PX}px;
      color: var(--webnote-annotation-text-color);
      font: 600 16px/1.55 "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      letter-spacing: 0.01em;
      white-space: pre-wrap;
      word-break: break-word;
      text-shadow: 0 1px 2px rgba(255, 255, 255, 0.88);
      transition: outline-color 140ms ease, opacity 140ms ease, transform 140ms ease;
    }

    .${ANNOTATION_CARD_CLASS} {
      border-radius: 12px;
      user-select: none;
    }

    .${ANNOTATION_CARD_HIDDEN_CLASS} {
      opacity: 0;
      pointer-events: none;
    }

    .${ANNOTATION_CARD_PREVIEW_CLASS} {
      transition: none;
    }

    .${ANNOTATION_CARD_CONTENT_CLASS} {
      display: block;
      min-height: ${MIN_EDITOR_HEIGHT_PX}px;
      padding: 8px ${ANNOTATION_RESIZE_HANDLE_SIZE_PX + 16}px ${ANNOTATION_RESIZE_HANDLE_SIZE_PX + 12}px 12px;
      border-radius: inherit;
      background: transparent;
    }

    .${ANNOTATION_CANVAS_INTERACTIVE_CLASS} .${ANNOTATION_CARD_CLASS}:hover {
      outline: 1px dashed var(--webnote-annotation-accent-color);
      outline-offset: 4px;
      transform: translateY(-1px);
    }

    .${ANNOTATION_CARD_DELETE_CLASS} {
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

    .${ANNOTATION_CARD_GRIP_CLASS} {
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

    .${ANNOTATION_CARD_GRIP_CLASS}::before {
      content: "";
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background:
        radial-gradient(circle, currentColor 1.2px, transparent 1.2px) 0 0 / 5px 5px;
      opacity: 0.7;
    }

    .${ANNOTATION_RESIZE_HANDLE_CLASS} {
      position: absolute;
      right: -4px;
      bottom: -4px;
      display: none;
      width: ${ANNOTATION_RESIZE_HANDLE_SIZE_PX}px;
      height: ${ANNOTATION_RESIZE_HANDLE_SIZE_PX}px;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: var(--webnote-annotation-accent-color);
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9);
      cursor: ew-resize;
      pointer-events: auto;
      transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
      opacity: 0.94;
    }

    .${ANNOTATION_CANVAS_INTERACTIVE_CLASS} .${ANNOTATION_CARD_CLASS}:hover .${ANNOTATION_CARD_DELETE_CLASS},
    .${ANNOTATION_CANVAS_INTERACTIVE_CLASS} .${ANNOTATION_CARD_CLASS}:hover .${ANNOTATION_CARD_GRIP_CLASS},
    .${ANNOTATION_CANVAS_INTERACTIVE_CLASS} .${ANNOTATION_CARD_CLASS}:hover .${ANNOTATION_RESIZE_HANDLE_CLASS},
    .${ANNOTATION_EDITOR_OPEN_CLASS} .${ANNOTATION_RESIZE_HANDLE_CLASS} {
      display: grid;
      place-items: center;
    }

    .${ANNOTATION_CANVAS_INTERACTIVE_CLASS} .${ANNOTATION_CARD_CLASS}:hover .${ANNOTATION_RESIZE_HANDLE_CLASS},
    .${ANNOTATION_EDITOR_OPEN_CLASS} .${ANNOTATION_RESIZE_HANDLE_CLASS}:hover {
      transform: scale(1.08);
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.92), 0 6px 14px rgba(37, 99, 235, 0.3);
    }

    .${ANNOTATION_EDITOR_CLASS} {
      display: none;
      z-index: 2147483646;
      pointer-events: auto;
      outline: 1px dashed var(--webnote-annotation-accent-color);
      outline-offset: 4px;
      border-radius: 12px;
      background: transparent;
    }

    .${ANNOTATION_EDITOR_OPEN_CLASS} {
      display: block;
    }

    .${ANNOTATION_EDITOR_INPUT_CLASS} {
      display: block;
      width: 100%;
      min-height: ${MIN_EDITOR_HEIGHT_PX}px;
      padding: 8px ${ANNOTATION_RESIZE_HANDLE_SIZE_PX + 16}px ${ANNOTATION_RESIZE_HANDLE_SIZE_PX + 12}px 12px;
      border: 0;
      outline: 0;
      resize: none;
      overflow: hidden;
      background: transparent;
      color: inherit;
      caret-color: var(--webnote-annotation-accent-color);
      font: inherit;
      line-height: inherit;
      letter-spacing: inherit;
      box-sizing: border-box;
    }

    .${ANNOTATION_EDITOR_INPUT_CLASS}::placeholder {
      color: rgba(100, 116, 139, 0.46);
    }
  `;
  document.head.append(styleElement);
};

export const createResizeHandleElement = (): HTMLButtonElement => {
  const handleElement = document.createElement("button");
  handleElement.className = ANNOTATION_RESIZE_HANDLE_CLASS;
  handleElement.dataset.webnoteOverlay = "true";
  handleElement.type = "button";
  handleElement.tabIndex = -1;
  handleElement.setAttribute("aria-label", "Resize annotation");
  return handleElement;
};

export const createEditorInputElement = (): HTMLTextAreaElement => {
  const editorElement = document.createElement("textarea");
  editorElement.className = ANNOTATION_EDITOR_INPUT_CLASS;
  editorElement.dataset.webnoteOverlay = "true";
  editorElement.placeholder = ANNOTATION_PLACEHOLDER;
  editorElement.spellcheck = false;
  return editorElement;
};

export const autosizeAnnotationEditor = (editorElement: HTMLTextAreaElement): void => {
  editorElement.style.height = "0px";
  editorElement.style.height = `${Math.max(MIN_EDITOR_HEIGHT_PX, editorElement.scrollHeight)}px`;
};

const getOverlayMountTarget = (): HTMLElement => document.body ?? document.documentElement;

const normalizeAnnotationFrameBase = (frame: AnnotationFrame): AnnotationFrame => ({
  width: Math.max(Math.round(frame.width), ANNOTATION_MIN_WIDTH_PX),
  x: Math.round(frame.x),
  y: Math.round(frame.y)
});

export const ensureOverlayElementAttached = (element: HTMLElement): void => {
  injectAnnotationStyles();
  const mountTarget = getOverlayMountTarget();

  if (element.parentElement === mountTarget) {
    return;
  }

  mountTarget.append(element);
};

export const applyAnnotationColor = (
  element: HTMLElement,
  colorToken: ColorToken
): ColorToken => {
  const normalizedColorToken = normalizeColorToken(
    colorToken,
    DEFAULT_ANNOTATION_COLOR_TOKEN
  );
  const paletteEntry = getColorPaletteEntry(normalizedColorToken);
  element.style.setProperty("--webnote-annotation-accent-color", paletteEntry.annotation.accent);
  element.style.setProperty("--webnote-annotation-text-color", paletteEntry.annotation.text);
  return normalizedColorToken;
};

export const constrainInteractiveAnnotationFrame = (frame: AnnotationFrame): AnnotationFrame => {
  const normalizedFrame = normalizeAnnotationFrameBase(frame);

  return {
    ...normalizedFrame,
    x: Math.max(EDGE_PADDING_PX, normalizedFrame.x),
    y: Math.max(TOP_PADDING_PX, normalizedFrame.y)
  };
};

export const normalizeStoredAnnotationFrame = (frame: AnnotationFrame): AnnotationFrame =>
  normalizeAnnotationFrameBase(frame);

export const applyAnnotationFrame = (element: HTMLElement, frame: AnnotationFrame): AnnotationFrame => {
  const nextFrame = normalizeStoredAnnotationFrame(frame);
  element.style.left = `${nextFrame.x}px`;
  element.style.top = `${nextFrame.y}px`;
  element.style.width = `${nextFrame.width}px`;
  return nextFrame;
};

export const removeElementSafely = (element: Element | null | undefined): void => {
  if (!element) {
    return;
  }

  element.remove();
};
