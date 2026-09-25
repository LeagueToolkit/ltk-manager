// @vitest-environment happy-dom

import { afterEach, expect, it } from "vitest";

import { findMarked, focusMark, restoreFocus } from "../focusHandoff";

function tab(): HTMLElement {
  const root = document.createElement("div");
  root.tabIndex = -1;
  root.innerHTML = `
    <button class="tool">Fit</button>
    <div class="row" role="slider" tabindex="0">first</div>
    <div class="row" role="slider" tabindex="0">second</div>
  `;
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

it("finds the element of the same tag, class, role and place in another tab", () => {
  const left = tab();
  const mark = focusMark(left, left.querySelectorAll(".row")[1]!);
  const opened = tab();

  expect(findMarked(opened, mark!)).toBe(opened.querySelectorAll(".row")[1]);
  expect(focusMark(left, left)).toBeNull();
  expect(focusMark(left, document.body)).toBeNull();
});

it("moves focus onto the marked element, and not away from a control outside the tab", () => {
  const left = tab();
  const mark = focusMark(left, left.querySelector(".tool"));
  left.remove();

  const opened = tab();
  restoreFocus(opened, mark);
  expect(opened.querySelector(".tool")).toHaveFocus();

  const elsewhere = document.createElement("input");
  document.body.append(elsewhere);
  elsewhere.focus();
  restoreFocus(opened, mark);
  expect(elsewhere).toHaveFocus();
});
