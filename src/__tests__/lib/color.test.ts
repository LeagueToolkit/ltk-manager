import { contrastRatio, hslToRgb, relativeLuminance } from "@/lib/color";
import { ACCENT_PRESETS, prefersDarkInk } from "@/modules/settings/api/useTheme";

describe("hslToRgb", () => {
  it("returns the primaries at full saturation and half lightness", () => {
    expect(hslToRgb(0, 100, 50)).toEqual([1, 0, 0]);
    expect(hslToRgb(120, 100, 50)).toEqual([0, 1, 0]);
    expect(hslToRgb(240, 100, 50)).toEqual([0, 0, 1]);
  });

  it("returns black and white at the ends of lightness", () => {
    expect(hslToRgb(174, 100, 0)).toEqual([0, 0, 0]);
    expect(hslToRgb(174, 100, 100)).toEqual([1, 1, 1]);
  });

  it("returns grey when there is no saturation", () => {
    const [red, green, blue] = hslToRgb(174, 0, 40);
    expect(red).toBeCloseTo(0.4, 5);
    expect(green).toBeCloseTo(0.4, 5);
    expect(blue).toBeCloseTo(0.4, 5);
  });
});

describe("relativeLuminance", () => {
  it("spans 0 to 1 between black and white", () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 6);
    expect(relativeLuminance([1, 1, 1])).toBeCloseTo(1, 6);
  });
});

describe("contrastRatio", () => {
  it("reaches 21 between black and white", () => {
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 6);
  });

  it("does not care which luminance comes first", () => {
    expect(contrastRatio(0.4, 0.02)).toBeCloseTo(contrastRatio(0.02, 0.4), 6);
  });
});

describe("prefersDarkInk", () => {
  /* HSL lightness is not perceptual, so the accent ramp's one authored fill
     rung lands anywhere from a deep blue to a bright teal. These are the
     presets, and which of them carry white on a filled control. */
  const flips: Record<string, boolean> = {
    blue: false,
    purple: false,
    green: true,
    orange: true,
    pink: false,
    red: false,
    teal: true,
  };

  it.each(Object.entries(flips))("picks the readable ink for %s", (preset, dark) => {
    const hue = ACCENT_PRESETS[preset];
    expect(hue).toBeDefined();
    expect(prefersDarkInk(hue!)).toBe(dark);
  });

  it("keeps white on the hue behind the brand ramp", () => {
    expect(prefersDarkInk(223)).toBe(false);
  });

  it("answers for every hue on the picker's wheel", () => {
    for (let hue = 0; hue < 360; hue += 1) {
      expect(typeof prefersDarkInk(hue)).toBe("boolean");
    }
  });
});
