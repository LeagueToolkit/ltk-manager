import { measureElement, type Virtualizer } from "@tanstack/react-virtual";

/**
 * A measured row's height, or its last known height while a hidden pane lays it out at zero.
 *
 * A retained tab hides with `display: none`, where the resize observer reports every row as
 * zero tall. Caching those zeroes shrinks the list under its scroll offset, and the browser
 * clamps the offset to the shrunk height when the tab is shown again.
 */
export function measureRow<TElement extends Element>(
  element: TElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<HTMLDivElement, TElement>,
): number {
  const size = measureElement(element, entry, instance);
  if (size > 0 || element.getClientRects().length > 0) return size;

  const index = instance.indexFromElement(element);

  return instance.measurementsCache[index]?.size ?? instance.options.estimateSize(index);
}
