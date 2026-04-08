type UrlChangeHandler = (url: string) => void;

type HistoryMethod = "pushState" | "replaceState";

export const watchUrlChanges = (onChange: UrlChangeHandler): (() => void) => {
  const eventName = "webnote:url-change";
  let currentUrl = window.location.href;
  const originalHistoryMethods = new Map<HistoryMethod, History[HistoryMethod]>();

  const notifyIfChanged = (): void => {
    if (window.location.href === currentUrl) {
      return;
    }

    currentUrl = window.location.href;
    onChange(currentUrl);
  };

  const patchHistoryMethod = (method: HistoryMethod): void => {
    originalHistoryMethods.set(method, history[method]);

    history[method] = ((...args: Parameters<History[HistoryMethod]>) => {
      const result = originalHistoryMethods.get(method)?.apply(history, args);
      window.dispatchEvent(new Event(eventName));
      return result;
    }) as History[HistoryMethod];
  };

  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");

  const onNativeChange = (): void => notifyIfChanged();

  window.addEventListener(eventName, onNativeChange);
  window.addEventListener("hashchange", onNativeChange);
  window.addEventListener("popstate", onNativeChange);

  return () => {
    for (const [method, originalMethod] of originalHistoryMethods.entries()) {
      history[method] = originalMethod;
    }

    window.removeEventListener(eventName, onNativeChange);
    window.removeEventListener("hashchange", onNativeChange);
    window.removeEventListener("popstate", onNativeChange);
  };
};
