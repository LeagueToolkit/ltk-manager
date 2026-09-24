/** The LoL Meta Wiki's base URL, which is also the base for its relative links. */
export const META_WIKI = "https://meta-wiki.leaguetoolkit.dev/";

/** A class's page URL. The wiki uses the lowercased class name. */
export function classPageUrl(name: string): string {
  return `${META_WIKI}classes/${name.toLowerCase()}/`;
}

/** A property's section URL: its declaring class's page, anchored at the lowercased name. */
export function fieldPageUrl(owner: string, field: string): string {
  return `${classPageUrl(owner)}#${field.toLowerCase()}`;
}
