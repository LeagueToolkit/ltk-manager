import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect } from "react";

import { oklchHueFromHsl } from "@/lib/color";

import { useSettings } from "./useSettings";

/**
 * The LeagueToolkit brand accent.
 *
 * Its ramp is spelled out as literals in `global.css` under
 * `[data-accent="ltk"]` rather than generated from a hue, because the light
 * end of the brand ramp drifts toward cyan and a single-hue ramp cannot
 * reach it.
 */
const LTK_PRESET = "ltk";

/** Hues for the generated accent presets. `ltk` is deliberately absent. */
const ACCENT_PRESETS: Record<string, number> = {
  blue: 207,
  purple: 271,
  green: 122,
  orange: 36,
  pink: 340,
  red: 4,
  teal: 174,
};

/** The hue behind the brand ramp, which has no preset entry to read one from. */
const BRAND_HUE = 223;

/**
 * Degrees the surface ramp sits ahead of the accent, in OKLCH.
 *
 * It is the brand's own spacing, so the brand accent reproduces the authored
 * `--surface-hue` and every other accent keeps the same relationship to its
 * surfaces.
 */
const SURFACE_HUE_OFFSET = 12.5;

/**
 * Hook to apply theme and accent color to the document.
 * Should be used at the app root level.
 */
export function useTheme() {
  const { data: settings } = useSettings();
  const theme = settings?.theme;
  const accentColor = settings?.accentColor;
  const backdropImage = settings?.backdropImage;
  const backdropBlur = settings?.backdropBlur;

  useEffect(() => {
    if (!theme) return;

    const root = document.documentElement;

    const applyTheme = (isDark: boolean) => {
      root.setAttribute("data-theme", isDark ? "dark" : "light");
    };

    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mediaQuery.matches);

      const handleChange = (e: MediaQueryListEvent) => {
        applyTheme(e.matches);
      };

      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } else {
      applyTheme(theme === "dark");
    }
  }, [theme]);

  useEffect(() => {
    if (!accentColor) return;

    const root = document.documentElement;

    // A custom hue always wins. Otherwise an unrecognised or absent preset
    // falls back to the brand, which is what a fresh install gets.
    const hue =
      accentColor.customHue ??
      (accentColor.preset ? ACCENT_PRESETS[accentColor.preset] : undefined);

    if (hue == null) {
      root.setAttribute("data-accent", LTK_PRESET);
      root.style.removeProperty("--accent-hue");
    } else {
      root.setAttribute("data-accent", "hue");
      root.style.setProperty("--accent-hue", String(hue));
    }

    const surfaceHue = (oklchHueFromHsl(hue ?? BRAND_HUE) + SURFACE_HUE_OFFSET) % 360;
    root.style.setProperty("--surface-hue", surfaceHue.toFixed(1));
  }, [accentColor]);

  useEffect(() => {
    const root = document.documentElement;

    if (backdropImage) {
      const assetUrl = convertFileSrc(backdropImage);
      root.classList.add("backdrop-active");
      root.style.setProperty("--backdrop-image", `url("${assetUrl}")`);
      root.style.setProperty("--backdrop-blur", `${backdropBlur ?? 40}px`);
    } else {
      root.classList.remove("backdrop-active");
      root.style.removeProperty("--backdrop-image");
      root.style.removeProperty("--backdrop-blur");
    }
  }, [backdropImage, backdropBlur]);
}

export { ACCENT_PRESETS, BRAND_HUE, LTK_PRESET };
