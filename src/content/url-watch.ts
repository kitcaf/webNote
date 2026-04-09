import { PAGE_ROUTE_CHANGE_EVENT } from "../shared/constants";

type UrlChangeHandler = (url: string) => void;

interface RouteChangeDetail {
  href?: string;
}

const getEventHref = (event: Event): string => {
  if (!(event instanceof CustomEvent)) {
    return window.location.href;
  }

  const eventDetail = event.detail as RouteChangeDetail | null;
  return typeof eventDetail?.href === "string" ? eventDetail.href : window.location.href;
};

export const watchUrlChanges = (onChange: UrlChangeHandler): (() => void) => {
  let currentUrl = window.location.href;

  const notifyIfChanged = (nextUrl: string): void => {
    if (nextUrl === currentUrl) {
      return;
    }

    currentUrl = nextUrl;
    onChange(nextUrl);
  };

  const handleRouteChange = (event: Event): void => {
    notifyIfChanged(getEventHref(event));
  };

  window.addEventListener(PAGE_ROUTE_CHANGE_EVENT, handleRouteChange as EventListener);
  window.addEventListener("popstate", handleRouteChange);
  window.addEventListener("hashchange", handleRouteChange);

  return () => {
    window.removeEventListener(PAGE_ROUTE_CHANGE_EVENT, handleRouteChange as EventListener);
    window.removeEventListener("popstate", handleRouteChange);
    window.removeEventListener("hashchange", handleRouteChange);
  };
};
