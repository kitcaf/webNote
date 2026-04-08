import { PANEL_EDITOR_ID } from "../shared/constants";

declare global {
  interface Window {
    Vditor?: VditorConstructor;
    VditorI18n?: Record<string, string>;
  }
}

type VditorConstructor = new (
  id: string | HTMLElement,
  options?: Record<string, unknown>
) => VditorInstance;

interface VditorInstance {
  destroy?: () => void;
  focus: () => void;
  getValue: () => string;
  insertValue: (value: string) => void;
  setValue: (value: string) => void;
}

interface EditorSessionOptions {
  initialMarkdown: string;
  pageKey: string;
  onInput: (markdown: string) => void;
}

interface EditorDriver {
  destroy(): void;
  focus(): void;
  getMarkdown(): string;
  insertMarkdown(markdown: string): void;
  replaceDocument(markdown: string): void;
}

const EDITOR_READY_TIMEOUT_MS = 8000;
const VDITOR_STYLE_ID = "webnote-vditor-style";
const VDITOR_I18N_SCRIPT_ID = "webnote-vditor-i18n-script";
const VDITOR_SCRIPT_ID = "webnote-vditor-script";
const PLAIN_EDITOR_PLACEHOLDER = "";

const getVditorAssetBase = (): string => chrome.runtime.getURL("vendor/vditor");

const getVditorStylesheetUrl = (): string => chrome.runtime.getURL("vendor/vditor/dist/index.css");

const getVditorI18nUrl = (): string => chrome.runtime.getURL("vendor/vditor/dist/js/i18n/en_US.js");

const getVditorScriptUrl = (): string => chrome.runtime.getURL("vendor/vditor/dist/index.min.js");

const getLuteScriptPath = (): string => chrome.runtime.getURL("vendor/vditor/dist/js/lute/lute.min.js");

const ensureStylesheetLoaded = (): void => {
  if (document.getElementById(VDITOR_STYLE_ID)) {
    return;
  }

  const linkElement = document.createElement("link");
  linkElement.id = VDITOR_STYLE_ID;
  linkElement.rel = "stylesheet";
  linkElement.href = getVditorStylesheetUrl();
  document.head.append(linkElement);
};

const ensureScriptLoaded = (id: string, url: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const existingScript = document.getElementById(id);

    if (existingScript instanceof HTMLScriptElement) {
      if (existingScript.dataset.loaded === "true") {
        resolve();
        return;
      }

      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error(`Failed to load ${url}`)), { once: true });
      return;
    }

    const scriptElement = document.createElement("script");
    scriptElement.async = true;
    scriptElement.id = id;
    scriptElement.src = url;
    scriptElement.addEventListener("load", () => {
      scriptElement.dataset.loaded = "true";
      resolve();
    }, { once: true });
    scriptElement.addEventListener("error", () => {
      reject(new Error(`Failed to load ${url}`));
    }, { once: true });
    document.head.append(scriptElement);
  });

const createReadyTimeout = (): Promise<never> =>
  new Promise((_, reject) => {
    window.setTimeout(() => {
      reject(new Error("Vditor initialization timed out."));
    }, EDITOR_READY_TIMEOUT_MS);
  });

class PlainTextDriver implements EditorDriver {
  private readonly textarea: HTMLTextAreaElement;
  private suppressInput = false;

  constructor(
    private readonly host: HTMLElement,
    initialMarkdown: string,
    private readonly onInput: (markdown: string) => void
  ) {
    this.textarea = document.createElement("textarea");
    this.textarea.className = "plain-editor";
    this.textarea.placeholder = PLAIN_EDITOR_PLACEHOLDER;
    this.textarea.spellcheck = false;
    this.textarea.value = initialMarkdown;
    this.textarea.addEventListener("input", () => {
      if (this.suppressInput) {
        return;
      }

      this.onInput(this.textarea.value);
    });
    this.host.replaceChildren(this.textarea);
  }

  destroy(): void {
    this.textarea.remove();
  }

  focus(): void {
    this.textarea.focus();
  }

  getMarkdown(): string {
    return this.textarea.value;
  }

  insertMarkdown(markdown: string): void {
    const { selectionEnd, selectionStart, value } = this.textarea;
    const nextValue = `${value.slice(0, selectionStart)}${markdown}${value.slice(selectionEnd)}`;
    const nextCursorPosition = selectionStart + markdown.length;

    this.suppressInput = true;
    this.textarea.value = nextValue;
    this.textarea.selectionStart = nextCursorPosition;
    this.textarea.selectionEnd = nextCursorPosition;
    this.suppressInput = false;
    this.onInput(nextValue);
  }

  replaceDocument(markdown: string): void {
    if (this.textarea.value === markdown) {
      return;
    }

    this.suppressInput = true;
    this.textarea.value = markdown;
    this.suppressInput = false;
  }
}

class VditorDriver implements EditorDriver {
  private suppressInput = false;

  constructor(
    private readonly instance: VditorInstance,
    private readonly onInput: (markdown: string) => void
  ) {}

  static async create(
    host: HTMLElement,
    initialMarkdown: string,
    onInput: (markdown: string) => void
  ): Promise<VditorDriver> {
    ensureStylesheetLoaded();

    await ensureScriptLoaded(VDITOR_I18N_SCRIPT_ID, getVditorI18nUrl());
    await ensureScriptLoaded(VDITOR_SCRIPT_ID, getVditorScriptUrl());

    if (!window.VditorI18n) {
      throw new Error("Vditor i18n assets did not register themselves on window.");
    }

    if (!window.Vditor) {
      throw new Error("Vditor did not register itself on window.");
    }

    let driver: VditorDriver | null = null;

    const instance = (await Promise.race([
      new Promise<VditorInstance>((resolve) => {
        const editor = new window.Vditor!(host.id, {
          _lutePath: getLuteScriptPath(),
          cache: {
            enable: false
          },
          cdn: getVditorAssetBase(),
          height: "100%",
          i18n: window.VditorI18n,
          icon: undefined,
          lang: "en_US",
          minHeight: 0,
          mode: "ir",
          placeholder: "",
          preview: {
            hljs: {
              enable: false
            },
            markdown: {
              codeBlockPreview: false,
              mathBlockPreview: false
            }
          },
          toolbar: [],
          toolbarConfig: {
            hide: true
          },
          value: initialMarkdown,
          after: () => {
            resolve(editor);
          },
          input: (markdown: string) => {
            if (driver?.suppressInput) {
              return;
            }

            onInput(markdown);
          }
        });
      }),
      createReadyTimeout()
    ])) as VditorInstance;

    driver = new VditorDriver(instance, onInput);
    return driver;
  }

  destroy(): void {
    this.instance.destroy?.();
  }

  focus(): void {
    this.instance.focus();
  }

  getMarkdown(): string {
    return this.instance.getValue();
  }

  insertMarkdown(markdown: string): void {
    this.instance.insertValue(markdown);
    this.onInput(this.instance.getValue());
  }

  replaceDocument(markdown: string): void {
    if (this.instance.getValue() === markdown) {
      return;
    }

    this.suppressInput = true;
    this.instance.setValue(markdown);
    this.suppressInput = false;
  }
}

export class EditorSessionManager {
  private readonly host: HTMLElement;
  private currentPageKey: string | null = null;
  private driver: EditorDriver | null = null;

  constructor(hostId = PANEL_EDITOR_ID) {
    const hostElement = document.getElementById(hostId);

    if (!(hostElement instanceof HTMLElement)) {
      throw new Error(`Could not find the editor host element: ${hostId}`);
    }

    this.host = hostElement;
  }

  private createFallbackDriver(options: EditorSessionOptions): EditorDriver {
    return new PlainTextDriver(this.host, options.initialMarkdown, options.onInput);
  }

  private async createDriver(options: EditorSessionOptions): Promise<EditorDriver> {
    try {
      return await VditorDriver.create(this.host, options.initialMarkdown, options.onInput);
    } catch (error) {
      console.error("Vditor initialization failed. Falling back to the plain markdown editor.", error);
      return this.createFallbackDriver(options);
    }
  }

  private destroyDriver(): void {
    if (!this.driver) {
      return;
    }

    this.driver.destroy();
    this.driver = null;
    this.host.replaceChildren();
  }

  async ensureSession(options: EditorSessionOptions): Promise<void> {
    if (this.driver && this.currentPageKey === options.pageKey) {
      this.driver.replaceDocument(options.initialMarkdown);
      return;
    }

    this.destroyDriver();
    this.currentPageKey = options.pageKey;
    this.driver = await this.createDriver(options);
    this.driver.focus();
  }

  clear(): void {
    this.currentPageKey = null;
    this.destroyDriver();
  }

  getMarkdown(): string {
    return this.driver?.getMarkdown() ?? "";
  }

  insertMarkdown(markdown: string): void {
    if (!this.driver) {
      throw new Error("The editor session is not ready yet.");
    }

    this.driver.insertMarkdown(markdown);
  }
}
