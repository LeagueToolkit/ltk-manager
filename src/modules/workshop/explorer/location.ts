/**
 * Where an explorer is: one directory of its source, addressed by its path.
 *
 * A tree has no current directory and a grid needs one, so this is the piece
 * that makes the two views one explorer. The root is the empty path, and every
 * path here is the same string the source's own listings address a directory
 * by.
 */

import { UNKNOWN_DIR } from "../gameBrowser/sourceIndex";

/** One place on the route to a location, and what a click on it goes to. */
export interface Crumb {
  readonly path: string;
  readonly label: string;
}

/** The directory holding `path`, and the root for a path already at it. */
export function parentLocation(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** `segment` addressed under `location`. */
export function childLocation(location: string, segment: string): string {
  return location.length === 0 ? segment : `${location}/${segment}`;
}

/**
 * The root, every directory on the way down, and the location itself.
 *
 * An explorer that opens already standing in a directory has walked no route to
 * it, so the history has nothing to walk back through. This is the route it
 * would have taken, which is what the arrows lay down in its place.
 */
export function ancestorLocations(location: string): string[] {
  const walked = [""];

  let path = "";
  for (const segment of location.split("/").filter((part) => part.length > 0)) {
    path = childLocation(path, segment);
    walked.push(path);
  }

  return walked;
}

/**
 * The source's own crumb, then one for each segment of the location.
 *
 * A folded chain of single-child directories draws a crumb for each of its
 * segments rather than one for the run, because a crumb is a place a user
 * lands on and the fold would hide those places. Every intermediate path
 * resolves in the sources, so each of those crumbs is reachable.
 */
export function crumbsOf(sourceLabel: string, location: string): Crumb[] {
  const crumbs: Crumb[] = [{ path: "", label: sourceLabel }];

  let walked = "";
  for (const segment of location.split("/").filter((part) => part.length > 0)) {
    walked = childLocation(walked, segment);
    crumbs.push({ path: walked, label: segment === UNKNOWN_DIR ? "unknown" : segment });
  }

  return crumbs;
}
