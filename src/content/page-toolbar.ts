export type PageToolMode = "highlight" | "annotation" | null;

interface PageToolbarHandlers {
  onModeChange: (mode: PageToolMode) => void;
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
      gap: 6px;
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

    .webnote-page-toolbar__button:focus-visible {
      outline: 2px solid rgba(37, 99, 235, 0.28);
      outline-offset: 2px;
    }

    .webnote-page-toolbar__button[aria-pressed="true"] {
      background: #2563eb;
      color: #ffffff;
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
  private readonly root: HTMLDivElement;
  private readonly highlightButton: HTMLButtonElement;
  private readonly annotationButton: HTMLButtonElement;
  private activeMode: PageToolMode = null;

  constructor(private readonly handlers: PageToolbarHandlers) {
    injectToolbarStyles();

    this.root = document.createElement("div");
    this.root.className = "webnote-page-toolbar";
    this.root.dataset.webnoteOverlay = "true";

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

    this.root.append(this.highlightButton, this.annotationButton);
    document.body.append(this.root);
  }

  isOwnedTarget(target: EventTarget | null): boolean {
    return target instanceof Node && this.root.contains(target);
  }

  setMode(mode: PageToolMode): void {
    this.activeMode = mode;
    this.highlightButton.setAttribute("aria-pressed", String(mode === "highlight"));
    this.annotationButton.setAttribute("aria-pressed", String(mode === "annotation"));
  }

  private toggleMode(mode: Exclude<PageToolMode, null>): void {
    const nextMode = this.activeMode === mode ? null : mode;
    this.setMode(nextMode);
    this.handlers.onModeChange(nextMode);
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
      this.toggleMode(mode);
    });

    buttonElement.setAttribute("aria-pressed", "false");
    return buttonElement;
  }
}
