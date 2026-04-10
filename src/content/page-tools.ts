import {
  DEFAULT_ANNOTATION_COLOR_TOKEN,
  DEFAULT_HIGHLIGHT_COLOR_TOKEN,
  type ColorToken
} from "../shared/colors";

export type PageToolMode = "highlight" | "annotation" | null;

export interface PageToolState {
  annotationColor: ColorToken;
  highlightColor: ColorToken;
  mode: PageToolMode;
}

export const createDefaultPageToolState = (): PageToolState => ({
  annotationColor: DEFAULT_ANNOTATION_COLOR_TOKEN,
  highlightColor: DEFAULT_HIGHLIGHT_COLOR_TOKEN,
  mode: null
});

export const clonePageToolState = (state: PageToolState): PageToolState => ({
  annotationColor: state.annotationColor,
  highlightColor: state.highlightColor,
  mode: state.mode
});

export const getColorForMode = (
  state: PageToolState,
  mode: Exclude<PageToolMode, null>
): ColorToken => (mode === "highlight" ? state.highlightColor : state.annotationColor);
