import type { PageKey } from "../shared/types";

const DRAFT_STORAGE_PREFIX = "webnote:draft:";

const getDraftStorageKey = (pageKey: PageKey): string => `${DRAFT_STORAGE_PREFIX}${pageKey}`;

const canUseLocalStorage = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

export const deleteCachedDraft = (pageKeyOrUrl: string): void => {
  if (!canUseLocalStorage() || pageKeyOrUrl.trim().length === 0) {
    return;
  }

  try {
    window.localStorage.removeItem(getDraftStorageKey(pageKeyOrUrl));
  } catch (error) {
    console.warn("WebNote failed to clear the cached draft.", error);
  }
};
