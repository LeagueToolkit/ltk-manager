// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { StepperField } from "@/components";

function Speed({ onChange }: { onChange: (value: number) => void }) {
  const [value, setValue] = useState(1);
  return (
    <StepperField
      aria-label="Speed"
      increaseLabel="Faster"
      decreaseLabel="Slower"
      value={value}
      min={0.05}
      max={2}
      step={0.1}
      decimals={3}
      locale="en-US"
      onValueChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("StepperField", () => {
  it("draws the value to its decimals", () => {
    render(<Speed onChange={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "Speed" })).toHaveValue("1.000");
  });

  it("nudges the value by a step from either arrow, held inside the range", async () => {
    const onChange = vi.fn();
    render(<Speed onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Faster" }));
    expect(onChange).toHaveBeenLastCalledWith(1.1);
    expect(screen.getByRole("textbox", { name: "Speed" })).toHaveValue("1.100");

    await userEvent.click(screen.getByRole("button", { name: "Slower" }));
    await userEvent.click(screen.getByRole("button", { name: "Slower" }));
    expect(onChange).toHaveBeenLastCalledWith(0.9);
  });

  it("takes a typed value, and never reports an empty field", async () => {
    const onChange = vi.fn();
    render(<Speed onChange={onChange} />);
    const field = screen.getByRole("textbox", { name: "Speed" });

    await userEvent.clear(field);
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.type(field, "0.125");
    fireEvent.blur(field);
    expect(onChange).toHaveBeenLastCalledWith(0.125);
    expect(field).toHaveValue("0.125");
  });

  it("puts the held value back when a cleared field is left", async () => {
    render(<Speed onChange={vi.fn()} />);
    const field = screen.getByRole("textbox", { name: "Speed" });

    await userEvent.clear(field);
    fireEvent.blur(field);

    expect(field).toHaveValue("1.000");
  });
});
