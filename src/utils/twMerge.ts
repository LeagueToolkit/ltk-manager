import { extendTailwindMerge } from "tailwind-merge";

/**
 * `twMerge`, taught the type scale this app authors.
 *
 * Stock tailwind-merge reads `text-*` against Tailwind's own t-shirt sizes, so a
 * tier of ours falls through to the text-colour group instead. A class list
 * naming both then has two entries in one group and the merge keeps the last,
 * which silently deletes the size:
 *
 * ```
 * twMerge("text-meta", "text-surface-300") // "text-surface-300"
 * ```
 *
 * Naming the tiers here puts them back in the font-size group, where a colour
 * beside them is a different question and both survive.
 */
export const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["row", "meta", "fine", "code", "mono-row"] }],
    },
  },
});
