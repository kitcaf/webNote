const EXPECTED_RUNTIME_ERROR_PATTERNS = [
  "Extension context invalidated",
  "Could not establish connection. Receiving end does not exist.",
  "The message port closed before a response was received."
];

const getErrorMessage = (error: unknown): string => {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "";
};

export const isExpectedRuntimeLifecycleError = (error: unknown): boolean =>
  EXPECTED_RUNTIME_ERROR_PATTERNS.some((pattern) => getErrorMessage(error).includes(pattern));
