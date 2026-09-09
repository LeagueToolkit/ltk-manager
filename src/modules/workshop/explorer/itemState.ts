/** What the selection makes an item look like, in whichever view draws it. */

/* Half the selected fill, so the reach of a selected directory is visible
   without a count. */
const COVERED_FILL = "bg-accent-500/8";

export interface ItemState {
  selected: boolean;
  /** A selected directory holds this item, so it draws the fill at half strength. */
  covered: boolean;
  focused: boolean;
}

/** The fill and the ring the three states add, in the order they layer. */
export function itemStateClasses({ selected, covered, focused }: ItemState): string {
  return [
    covered && COVERED_FILL,
    selected && "bg-accent-500/15",
    focused && "ring-1 ring-accent-500",
  ]
    .filter((each): each is string => typeof each === "string")
    .join(" ");
}

/** The name's colour, which is the one thing a selected item states twice. */
export function itemNameClass(selected: boolean): string {
  return selected ? "text-accent-100" : "text-surface-200";
}
