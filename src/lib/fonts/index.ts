/**
 * Every face a user may choose, and everything the app needs in order to offer it.
 *
 * Adding a face is an entry here with its `load`, and nothing else. There is no
 * measured metric to work out and no per-face stylesheet block to write - the
 * x-height a face renders at is the browser's job through `font-size-adjust`,
 * and the family reaches the root element from this table.
 *
 * A face with no `load` is one `styles/tailwind.css` imports eagerly, which is
 * the two defaults and the display face. Every other face is a chunk the
 * selection pulls in, so a launch pays for the faces it draws with.
 */

/** The darkness steps `font-medium` and friends resolve through. */
export const WEIGHT_TIERS = ["normal", "medium", "semibold", "bold"] as const;

export type WeightTier = (typeof WEIGHT_TIERS)[number];

interface Face {
  /** What the picker calls the face. */
  label: string;
  /** The family name fontsource registers, without its fallbacks. */
  family: string;
  /**
   * The weights this face reaches the tiers at, for a face that the plain scale
   * reads wrong on. These are the face's own numbers rather than a translation
   * of anybody else's, so a change to one face never invalidates another.
   *
   * Omitting this is the default and the case worth aiming for. A tier left out
   * keeps the plain number from `--weight-*`.
   */
  weights?: Partial<Record<WeightTier, number>>;
  /**
   * Pulls the face's stylesheet in, resolving once the family is registered.
   *
   * Omitted for a face `styles/tailwind.css` imports at boot.
   */
  load?: () => Promise<unknown>;
}

export const SANS_FACES = {
  geist: { label: "Geist", family: "Geist Variable" },
  inter: {
    label: "Inter",
    family: "Inter Variable",
    load: () => import("@fontsource-variable/inter"),
  },
  plex: {
    label: "IBM Plex Sans",
    family: "IBM Plex Sans Variable",
    weights: { normal: 440, medium: 505, semibold: 610 },
    load: () => import("@fontsource-variable/ibm-plex-sans"),
  },
  nunito: {
    label: "Nunito Sans",
    family: "Nunito Sans Variable",
    weights: { normal: 565, medium: 675, semibold: 765, bold: 850 },
    load: () => import("@fontsource-variable/nunito-sans"),
  },
  atkinson: {
    label: "Atkinson Hyperlegible",
    family: "Atkinson Hyperlegible Next Variable",
    weights: { normal: 430, medium: 545, semibold: 690, bold: 790 },
    load: () => import("@fontsource-variable/atkinson-hyperlegible-next"),
  },
} satisfies Record<string, Face>;

export const MONO_FACES = {
  geist: { label: "Geist Mono", family: "Geist Mono Variable" },
  jetbrains: {
    label: "JetBrains Mono",
    family: "JetBrains Mono Variable",
    load: () => import("@fontsource-variable/jetbrains-mono"),
  },
  fira: {
    label: "Fira Code",
    family: "Fira Code Variable",
    load: () => import("@fontsource-variable/fira-code"),
  },
  source: {
    label: "Source Code Pro",
    family: "Source Code Pro Variable",
    load: () => import("@fontsource-variable/source-code-pro"),
  },
} satisfies Record<string, Face>;

export type SansFont = keyof typeof SANS_FACES;
export type MonoFont = keyof typeof MONO_FACES;

/* A face is bundled, so the fallbacks only matter for the moment before it
   loads and for a build that somehow shipped without it. */
const SANS_FALLBACK = "system-ui, sans-serif";
const MONO_FALLBACK = "ui-monospace, monospace";

export function sansStack(font: SansFont): string {
  return `"${SANS_FACES[font].family}", ${SANS_FALLBACK}`;
}

export function monoStack(font: MonoFont): string {
  return `"${MONO_FACES[font].family}", ${MONO_FALLBACK}`;
}

export function sansWeights(font: SansFont): Partial<Record<WeightTier, number>> {
  const face: Face = SANS_FACES[font];
  return face.weights ?? {};
}

export const SANS_OPTIONS = Object.entries(SANS_FACES).map(([value, face]) => ({
  value: value as SansFont,
  label: face.label,
}));

export const MONO_OPTIONS = Object.entries(MONO_FACES).map(([value, face]) => ({
  value: value as MonoFont,
  label: face.label,
}));

/** Register `font`, so a caller that applies the family after this draws with it. */
export function loadSansFace(font: SansFont): Promise<unknown> {
  const face: Face = SANS_FACES[font];
  return face.load?.() ?? Promise.resolve();
}

/** Register `font`, so a caller that applies the family after this draws with it. */
export function loadMonoFace(font: MonoFont): Promise<unknown> {
  const face: Face = MONO_FACES[font];
  return face.load?.() ?? Promise.resolve();
}

/** Register every sans face, for a picker that draws each row in the face it names. */
export function loadSansFaces(): Promise<unknown> {
  const faces: Face[] = Object.values(SANS_FACES);
  return Promise.all(faces.map((face) => face.load?.()));
}

/** Register every mono face, for a picker that draws each row in the face it names. */
export function loadMonoFaces(): Promise<unknown> {
  const faces: Face[] = Object.values(MONO_FACES);
  return Promise.all(faces.map((face) => face.load?.()));
}
