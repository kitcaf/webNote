import { PAGE_ROUTE_CHANGE_EVENT } from "../shared/constants";

type HistoryMethod = "pushState" | "replaceState";
type RouteChangeSource = HistoryMethod | "popstate" | "hashchange";

interface RouteChangeDetail {
  href: string;
  source: RouteChangeSource;
}

interface RouteBridgeWindow extends Window {
  __webnoteRouteBridgeInstalled__?: boolean;
}

const installRouteBridge = (): void => {
  const pageWindow = window as RouteBridgeWindow;

  if (pageWindow.__webnoteRouteBridgeInstalled__) {
    return;
  }

  pageWindow.__webnoteRouteBridgeInstalled__ = true;

  let currentHref = window.location.href;

  const emitRouteChange = (source: RouteChangeSource): void => {
    const nextHref = window.location.href;

    if (nextHref === currentHref) {
      return;
    }

    currentHref = nextHref;
    window.dispatchEvent(
      new CustomEvent<RouteChangeDetail>(PAGE_ROUTE_CHANGE_EVENT, {
        detail: {
          href: nextHref,
          source
        }
      })
    );
  };

  const patchHistoryMethod = (method: HistoryMethod): void => {
    const originalMethod = history[method];

    history[method] = ((...args: Parameters<History[HistoryMethod]>) => {
      const result = originalMethod.apply(history, args);
      emitRouteChange(method);
      return result;
    }) as History[HistoryMethod];
  };

  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");

  window.addEventListener("popstate", () => {
    emitRouteChange("popstate");
  });

  window.addEventListener("hashchange", () => {
    emitRouteChange("hashchange");
  });
};

// Run in the page world so SPA router calls hit the patched history methods.
installRouteBridge();
