import { APP_NAMESPACE } from "./constants";

export type ColorToken = "yellow" | "green" | "blue" | "pink" | "orange";

export interface ColorPaletteEntry {
  annotation: {
    accent: string;
    text: string;
  };
  highlight: {
    activeFill: string;
    fill: string;
  };
  label: string;
  swatch: string;
}

export const COLOR_TOKENS = ["yellow", "green", "blue", "pink", "orange"] as const satisfies readonly ColorToken[];

export const DEFAULT_HIGHLIGHT_COLOR_TOKEN: ColorToken = "yellow";
export const DEFAULT_ANNOTATION_COLOR_TOKEN: ColorToken = "yellow";

export const HIGHLIGHT_COLOR_PREFERENCE_STORAGE_KEY = `${APP_NAMESPACE}:highlight-color-preference`;
export const ANNOTATION_COLOR_PREFERENCE_STORAGE_KEY = `${APP_NAMESPACE}:annotation-color-preference`;

const COLOR_TOKEN_SET = new Set<ColorToken>(COLOR_TOKENS);

const COLOR_PALETTE: Record<ColorToken, ColorPaletteEntry> = {
  blue: {
    annotation: {
      accent: "#2563EB",
      text: "#1D4ED8"
    },
    highlight: {
      activeFill: "rgba(59, 130, 246, 0.42)",
      fill: "rgba(96, 165, 250, 0.30)"
    },
    label: "Blue",
    swatch: "#60A5FA"
  },
  green: {
    annotation: {
      accent: "#16A34A",
      text: "#15803D"
    },
    highlight: {
      activeFill: "rgba(34, 197, 94, 0.40)",
      fill: "rgba(74, 222, 128, 0.28)"
    },
    label: "Green",
    swatch: "#4ADE80"
  },
  orange: {
    annotation: {
      accent: "#EA580C",
      text: "#C2410C"
    },
    highlight: {
      activeFill: "rgba(249, 115, 22, 0.40)",
      fill: "rgba(251, 146, 60, 0.28)"
    },
    label: "Orange",
    swatch: "#FB923C"
  },
  pink: {
    annotation: {
      accent: "#DB2777",
      text: "#BE185D"
    },
    highlight: {
      activeFill: "rgba(236, 72, 153, 0.38)",
      fill: "rgba(244, 114, 182, 0.26)"
    },
    label: "Pink",
    swatch: "#F472B6"
  },
  yellow: {
    annotation: {
      accent: "#CA8A04",
      text: "#A16207"
    },
    highlight: {
      activeFill: "rgba(245, 158, 11, 0.42)",
      fill: "rgba(250, 204, 21, 0.34)"
    },
    label: "Yellow",
    swatch: "#FACC15"
  }
};

export const isColorToken = (candidate: unknown): candidate is ColorToken =>
  typeof candidate === "string" && COLOR_TOKEN_SET.has(candidate as ColorToken);

export const normalizeColorToken = (
  candidate: unknown,
  fallback: ColorToken = DEFAULT_HIGHLIGHT_COLOR_TOKEN
): ColorToken => (isColorToken(candidate) ? candidate : fallback);

export const getColorPaletteEntry = (colorToken: ColorToken): ColorPaletteEntry => COLOR_PALETTE[colorToken];
