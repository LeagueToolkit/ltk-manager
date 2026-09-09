import { describe, expect, it } from "vitest";

import {
  COLUMN_MAX,
  COLUMN_MIN,
  columnTemplate,
  DEFAULT_COLUMN_WIDTHS,
  KIND_DROP_WIDTH,
  resizedWidth,
  visibleColumns,
} from "../columns";

describe("visibleColumns", () => {
  it("draws the whole set at the drop width", () => {
    expect(visibleColumns(KIND_DROP_WIDTH)).toEqual(["name", "size", "kind"]);
  });

  it("drops the kind one pixel under the drop width", () => {
    expect(visibleColumns(KIND_DROP_WIDTH - 1)).toEqual(["name", "size"]);
  });

  it("treats an unmeasured pane as a wide one", () => {
    /* A ResizeObserver reports nothing until it has observed, and a header that
       drew two columns and then three would flash a column into place. */
    expect(visibleColumns(0)).toEqual(["name", "size", "kind"]);
  });

  it("keeps the name and the size however narrow the pane is", () => {
    expect(visibleColumns(120)).toEqual(["name", "size"]);
  });
});

describe("columnTemplate", () => {
  it("gives the name whatever the fixed columns leave", () => {
    expect(columnTemplate(["name", "size", "kind"], { size: 88, kind: 104 })).toBe(
      "minmax(0, 1fr) 88px 104px",
    );
  });

  it("names only the columns it is given", () => {
    expect(columnTemplate(["name", "size"], { size: 88, kind: 104 })).toBe("minmax(0, 1fr) 88px");
  });

  it("rounds a zoomed width to a whole pixel", () => {
    expect(columnTemplate(["name", "size"], { size: 88.4, kind: 104 })).toBe("minmax(0, 1fr) 88px");
  });
});

describe("resizedWidth", () => {
  it("adds the drag to where the divider started", () => {
    expect(resizedWidth(88, 20)).toBe(108);
  });

  it("stops at the narrowest a heading still reads in", () => {
    expect(resizedWidth(88, -400)).toBe(COLUMN_MIN);
  });

  it("stops before a fixed column crowds out the name", () => {
    expect(resizedWidth(88, 4000)).toBe(COLUMN_MAX);
  });

  it("holds the defaults inside its own bounds", () => {
    for (const width of Object.values(DEFAULT_COLUMN_WIDTHS)) {
      expect(resizedWidth(width, 0)).toBe(width);
    }
  });
});
