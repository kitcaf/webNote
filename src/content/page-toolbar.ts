import {
  COLOR_TOKENS,
  getColorPaletteEntry,
  type ColorToken
} from "../shared/colors";
import {
  clonePageToolState,
  createDefaultPageToolState,
  getColorForMode,
  type PageToolMode,
  type PageToolState
} from "./page-tools";

interface PageToolbarHandlers {
  onColorSelect: (mode: Exclude<PageToolMode, null>, colorToken: ColorToken) => void;
  onModeSelect: (mode: Exclude<PageToolMode, null>) => void;
}

const TOOLBAR_STYLE_ID = "webnote-page-toolbar-style";

const createSvgElement = <K extends keyof SVGElementTagNameMap>(
  tagName: K,
  attributes: Record<string, string>
): SVGElementTagNameMap[K] => {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);

  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }

  return element;
};

const createIcon = (paths: string[]): SVGSVGElement => {
  const svgElement = createSvgElement("svg", {
    fill: "none",
    height: "16",
    viewBox: "0 0 24 24",
    width: "16"
  });

  for (const pathDefinition of paths) {
    svgElement.append(
      createSvgElement("path", {
        d: pathDefinition,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "stroke-width": "1.8",
        stroke: "currentColor"
      })
    );
  }

  return svgElement;
};

const injectToolbarStyles = (): void => {
  if (document.getElementById(TOOLBAR_STYLE_ID)) {
    return;
  }

  const styleElement = document.createElement("style");
  styleElement.dataset.webnoteOverlay = "true";
  styleElement.id = TOOLBAR_STYLE_ID;
  styleElement.textContent = `
    .webnote-page-toolbar {
      position: fixed;
      top: 50%;
      right: -8px;
      z-index: 2147483646;
      display: grid;
      gap: 8px;
      justify-items: center;
      padding: 8px 12px 8px 6px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-right: 0;
      border-radius: 18px 0 0 18px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 14px 34px rgba(15, 23, 42, 0.1);
      transform: translateY(-50%);
      backdrop-filter: blur(12px);
      transition: right 160ms ease, box-shadow 160ms ease;
    }

    .webnote-page-toolbar__modes {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }

    .webnote-page-toolbar:hover {
      right: 0;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.14);
    }

    .webnote-page-toolbar__button {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      padding: 0;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: #475569;
      cursor: pointer;
      transition: background-color 140ms ease, color 140ms ease, transform 140ms ease;
    }

    .webnote-page-toolbar__button:hover {
      background: rgba(15, 23, 42, 0.06);
      color: #0f172a;
      transform: translateY(-1px);
    }

    .webnote-page-toolbar__button:focus-visible,
    .webnote-page-toolbar__swatch:focus-visible {
      outline: 2px solid rgba(37, 99, 235, 0.28);
      outline-offset: 2px;
    }

    .webnote-page-toolbar__button[aria-pressed="true"] {
      background: #2563eb;
      color: #ffffff;
    }

    .webnote-page-toolbar__colors {
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(15, 23, 42, 0.08);
    }

    .webnote-page-toolbar__colors--visible {
      display: flex;
    }

    .webnote-page-toolbar__swatch {
      --webnote-toolbar-swatch-color: #ffffff;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: var(--webnote-toolbar-swatch-color);
      box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.12);
      cursor: pointer;
      transition: transform 140ms ease, box-shadow 140ms ease;
    }

    .webnote-page-toolbar__swatch:hover {
      transform: translateY(-1px) scale(1.05);
    }

    .webnote-page-toolbar__swatch[aria-pressed="true"] {
      box-shadow:
        inset 0 0 0 1px rgba(15, 23, 42, 0.12),
        0 0 0 2px #ffffff,
        0 0 0 4px var(--webnote-toolbar-swatch-color);
      transform: scale(1.05);
    }
  `;

  document.head.append(styleElement);
};

const HIGHLIGHT_ICON_PATHS = [
  "M4 18.5 9.5 13",
  "M13 4.5 19.5 11",
  "M7.5 20h9"
];
const ANNOTATION_ICON_PATHS = [
  "M6 5.75h12",
  "M6 10.5h12",
  "M6 15.25h7.5",
  "m15.5 15.25 1.75 1.75L21 13.25"
];

export class PageToolbar {
  private readonly colorBar: HTMLDivElement;
  private readonly colorButtons = new Map<ColorToken, HTMLButtonElement>();
  private readonly root: HTMLDivElement;
  private readonly highlightButton: HTMLButtonElement;
  private readonly annotationButton: HTMLButtonElement;
  private readonly modeContainer: HTMLDivElement;
  private state = createDefaultPageToolState();

  constructor(private readonly handlers: PageToolbarHandlers) {
    injectToolbarStyles();

    this.root = document.createElement("div");
    this.root.className = "webnote-page-toolbar";
    this.root.dataset.webnoteOverlay = "true";
    this.modeContainer = document.createElement("div");
    this.modeContainer.className = "webnote-page-toolbar__modes";

    this.highlightButton = this.createModeButton(
      "Highlight mode",
      HIGHLIGHT_ICON_PATHS,
      "highlight"
    );
    this.annotationButton = this.createModeButton(
      "Annotate mode",
      ANNOTATION_ICON_PATHS,
      "annotation"
    );
    this.colorBar = document.createElement("div");
    this.colorBar.className = "webnote-page-toolbar__colors";
    this.colorBar.dataset.webnoteOverlay = "true";

    for (const colorToken of COLOR_TOKENS) {
      const colorButton = this.createColorButton(colorToken);
      this.colorButtons.set(colorToken, colorButton);
      this.colorBar.append(colorButton);
    }

    this.modeContainer.append(this.highlightButton, this.annotationButton);
    this.root.append(this.modeContainer, this.colorBar);
    document.body.append(this.root);
  }

  isOwnedTarget(target: EventTarget | null): boolean {
    return target instanceof Node && this.root.contains(target);
  }

  setState(state: PageToolState): void {
    this.state = clonePageToolState(state);
    const activeMode = this.state.mode;
    const activeColor = activeMode ? getColorForMode(this.state, activeMode) : null;
    this.highlightButton.setAttribute("aria-pressed", String(activeMode === "highlight"));
    this.annotationButton.setAttribute("aria-pressed", String(activeMode === "annotation"));
    this.colorBar.classList.toggle("webnote-page-toolbar__colors--visible", activeMode !== null);

    for (const [colorToken, colorButton] of this.colorButtons.entries()) {
      colorButton.setAttribute("aria-pressed", String(activeColor === colorToken));
    }
  }

  private createActionButton(
    title: string,
    iconPaths: string[],
    onClick: () => Promise<void>
  ): HTMLButtonElement {
    const buttonElement = document.createElement("button");
    buttonElement.className = "webnote-page-toolbar__button";
    buttonElement.dataset.webnoteOverlay = "true";
    buttonElement.title = title;
    buttonElement.type = "button";
    buttonElement.append(createIcon(iconPaths));
    buttonElement.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    buttonElement.addEventListener("click", () => {
      void onClick().catch((error) => {
        console.error("WebNote toolbar action failed.", error);
      });
    });
    return buttonElement;
  }

  private createModeButton(
    title: string,
    iconPaths: string[],
    mode: Exclude<PageToolMode, null>
  ): HTMLButtonElement {
    const buttonElement = this.createActionButton(title, iconPaths, async () => {
      this.handlers.onModeSelect(mode);
    });

    buttonElement.setAttribute("aria-pressed", "false");
    return buttonElement;
  }

  private createColorButton(colorToken: ColorToken): HTMLButtonElement {
    const paletteEntry = getColorPaletteEntry(colorToken);
    const buttonElement = document.createElement("button");
    buttonElement.className = "webnote-page-toolbar__swatch";
    buttonElement.dataset.webnoteOverlay = "true";
    buttonElement.style.setProperty("--webnote-toolbar-swatch-color", paletteEntry.swatch);
    buttonElement.title = paletteEntry.label;
    buttonElement.type = "button";
    buttonElement.setAttribute("aria-label", `${paletteEntry.label} color`);
    buttonElement.setAttribute("aria-pressed", "false");
    buttonElement.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    buttonElement.addEventListener("click", () => {
      if (!this.state.mode) {
        return;
      }

      this.handlers.onColorSelect(this.state.mode, colorToken);
    });
    return buttonElement;
  }
}
