import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect } from "react";

import { useSettings } from "./useSettings";

// Accent color preset hues
const ACCENT_PRESETS: Record<string, number> = {
  blue: 207,
  purple: 271,
  green: 122,
  orange: 36,
  pink: 340,
  red: 4,
  teal: 174,
};

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

    let hue: number;

    if (accentColor.customHue != null) {
      hue = accentColor.customHue;
    } else if (accentColor.preset && ACCENT_PRESETS[accentColor.preset]) {
      hue = ACCENT_PRESETS[accentColor.preset];
    } else {
      hue = ACCENT_PRESETS.blue;
    }

    root.style.setProperty("--accent-hue", String(hue));
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

export { ACCENT_PRESETS };
