/** Linearizes one sRGB channel, undoing the transfer function. */
function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** The sRGB channels of `hsl(hue, 100%, 50%)`, where the sextant reduces to one ramp. */
function fullySaturated(hue: number): [number, number, number] {
  const sextant = (((hue % 360) + 360) % 360) / 60;
  const ramp = 1 - Math.abs((sextant % 2) - 1);

  switch (Math.floor(sextant)) {
    case 0:
      return [1, ramp, 0];
    case 1:
      return [ramp, 1, 0];
    case 2:
      return [0, 1, ramp];
    case 3:
      return [0, ramp, 1];
    case 4:
      return [ramp, 0, 1];
    default:
      return [1, 0, ramp];
  }
}

/**
 * The OKLCH hue of `hsl(hue, 100%, 50%)`, in degrees.
 *
 * The two spaces number their hues differently, so a ramp authored in one
 * cannot be offset against a ramp authored in the other until both are read
 * in the same space.
 */
export function oklchHueFromHsl(hue: number): number {
  const [red, green, blue] = fullySaturated(hue).map(srgbToLinear);

  const long = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const medium = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const short = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;

  const l = Math.cbrt(long);
  const m = Math.cbrt(medium);
  const s = Math.cbrt(short);

  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}
