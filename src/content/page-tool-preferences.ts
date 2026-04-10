import {
  ANNOTATION_COLOR_PREFERENCE_STORAGE_KEY,
  DEFAULT_ANNOTATION_COLOR_TOKEN,
  DEFAULT_HIGHLIGHT_COLOR_TOKEN,
  HIGHLIGHT_COLOR_PREFERENCE_STORAGE_KEY,
  normalizeColorToken,
  type ColorToken
} from "../shared/colors";
import { isExpectedRuntimeLifecycleError } from "./runtime-errors";

type PersistedColorPreferenceMode = "highlight" | "annotation";

export interface PageToolColorPreferences {
  annotationColor: ColorToken;
  highlightColor: ColorToken;
}

export const loadPageToolColorPreferences = async (): Promise<PageToolColorPreferences> => {
  try {
    const storageResult = await chrome.storage.local.get([
      ANNOTATION_COLOR_PREFERENCE_STORAGE_KEY,
      HIGHLIGHT_COLOR_PREFERENCE_STORAGE_KEY
    ]);

    return {
      annotationColor: normalizeColorToken(
        storageResult[ANNOTATION_COLOR_PREFERENCE_STORAGE_KEY],
        DEFAULT_ANNOTATION_COLOR_TOKEN
      ),
      highlightColor: normalizeColorToken(
        storageResult[HIGHLIGHT_COLOR_PREFERENCE_STORAGE_KEY],
        DEFAULT_HIGHLIGHT_COLOR_TOKEN
      )
    };
  } catch (error) {
    if (isExpectedRuntimeLifecycleError(error)) {
      return {
        annotationColor: DEFAULT_ANNOTATION_COLOR_TOKEN,
        highlightColor: DEFAULT_HIGHLIGHT_COLOR_TOKEN
      };
    }

    console.warn("WebNote failed to load the tool color preferences.", error);
    return {
      annotationColor: DEFAULT_ANNOTATION_COLOR_TOKEN,
      highlightColor: DEFAULT_HIGHLIGHT_COLOR_TOKEN
    };
  }
};

export const persistPageToolColorPreference = (
  mode: PersistedColorPreferenceMode,
  colorToken: ColorToken
): void => {
  const storageKey =
    mode === "highlight"
      ? HIGHLIGHT_COLOR_PREFERENCE_STORAGE_KEY
      : ANNOTATION_COLOR_PREFERENCE_STORAGE_KEY;
  const fallbackColorToken =
    mode === "highlight" ? DEFAULT_HIGHLIGHT_COLOR_TOKEN : DEFAULT_ANNOTATION_COLOR_TOKEN;

  void chrome.storage.local
    .set({
      [storageKey]: normalizeColorToken(colorToken, fallbackColorToken)
    })
    .catch((error) => {
      if (isExpectedRuntimeLifecycleError(error)) {
        return;
      }

      console.warn("WebNote failed to persist the tool color preference.", error);
    });
};
