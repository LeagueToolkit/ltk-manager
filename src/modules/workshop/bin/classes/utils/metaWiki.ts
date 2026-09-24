/** Where the LoL Meta Wiki serves its pages, and what its relative links resolve against. */
export const META_WIKI = "https://meta-wiki.leaguetoolkit.dev/";

/** The wiki addresses a class by its name, lowercased. */
export function classPageUrl(name: string): string {
  return `${META_WIKI}classes/${name.toLowerCase()}/`;
}

/** A property is an anchor on its declaring class's page, lowercased like the page. */
export function fieldPageUrl(owner: string, field: string): string {
  return `${classPageUrl(owner)}#${field.toLowerCase()}`;
}
