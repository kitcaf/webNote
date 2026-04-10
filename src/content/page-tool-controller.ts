import { normalizeColorToken, type ColorToken } from "../shared/colors";
import {
  clonePageToolState,
  createDefaultPageToolState,
  type PageToolMode,
  type PageToolState
} from "./page-tools";

interface PageToolControllerOptions {
  onStateChange: (state: PageToolState) => void;
}

export class PageToolController {
  private state = createDefaultPageToolState();

  constructor(private readonly options: PageToolControllerOptions) {}

  clear(): void {
    this.setMode(null);
  }

  getColor(mode: Exclude<PageToolMode, null>): ColorToken {
    return mode === "highlight" ? this.state.highlightColor : this.state.annotationColor;
  }

  getMode(): PageToolMode {
    return this.state.mode;
  }

  getState(): PageToolState {
    return clonePageToolState(this.state);
  }

  hydrateColors(input: { annotationColor: ColorToken; highlightColor: ColorToken }): void {
    const nextAnnotationColor = normalizeColorToken(input.annotationColor, this.state.annotationColor);
    const nextHighlightColor = normalizeColorToken(input.highlightColor, this.state.highlightColor);

    if (
      nextAnnotationColor === this.state.annotationColor &&
      nextHighlightColor === this.state.highlightColor
    ) {
      return;
    }

    this.state = {
      ...this.state,
      annotationColor: nextAnnotationColor,
      highlightColor: nextHighlightColor
    };
    this.emitState();
  }

  setColor(mode: Exclude<PageToolMode, null>, colorToken: ColorToken): void {
    const normalizedColorToken = normalizeColorToken(colorToken, this.getColor(mode));
    const colorKey = mode === "highlight" ? "highlightColor" : "annotationColor";

    if (this.state[colorKey] === normalizedColorToken) {
      return;
    }

    this.state = {
      ...this.state,
      [colorKey]: normalizedColorToken
    };
    this.emitState();
  }

  setMode(mode: PageToolMode): void {
    if (this.state.mode === mode) {
      return;
    }

    this.state = {
      ...this.state,
      mode
    };
    this.emitState();
  }

  toggleMode(mode: Exclude<PageToolMode, null>): void {
    this.setMode(this.state.mode === mode ? null : mode);
  }

  private emitState(): void {
    this.options.onStateChange(clonePageToolState(this.state));
  }
}
