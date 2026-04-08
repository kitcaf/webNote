import type { PageToolMode } from "./page-toolbar";

interface ModeControllerOptions {
  onModeChange: (mode: PageToolMode) => void;
}

export class ModeController {
  private activeMode: PageToolMode = null;

  constructor(private readonly options: ModeControllerOptions) {}

  getMode(): PageToolMode {
    return this.activeMode;
  }

  setMode(mode: PageToolMode): void {
    this.activeMode = mode;
    this.options.onModeChange(mode);
  }

  clear(): void {
    this.setMode(null);
  }
}
