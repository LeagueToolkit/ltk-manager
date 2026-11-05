import type { ReactNode } from "react";

import { Tabs } from "@/components";
import { m } from "@/i18n";
import type { PassProgram } from "@/lib/tauri";

/** The tab of the material's own entries, which every pass reads. */
const ALL = "all";

export interface PassScopeBarProps {
  passes: readonly PassProgram[];
  /** The pass whose own entries the table shows, or null for the material's. */
  scope: number | null;
  onScope: (scope: number | null) => void;
  /** The table of the chosen scope. */
  children: ReactNode;
}

/**
 * The scopes a material's parameters are written at: the material, which every pass reads,
 * and each pass of the technique, whose own entries only that pass reads.
 *
 * "Pass values" in docs/ux/BIN_EDITOR.md. A tab names its pass by its place in the technique,
 * and its tooltip names the pass's shader.
 */
export function PassScopeBar({ passes, scope, onScope, children }: PassScopeBarProps) {
  const value = scope === null ? ALL : String(scope);

  return (
    <Tabs.Root
      value={value}
      onValueChange={(next) => onScope(next === ALL ? null : Number(next))}
      className="gap-1.5"
    >
      {/* DS-SCROLLBAR */}
      <Tabs.List
        variant="pills"
        aria-label={m.workshop_bin_material_scope_label()}
        className="h-7 max-w-full overflow-x-auto font-sans scrollbar-sm"
      >
        <Tabs.Tab value={ALL} title={m.workshop_bin_material_scope_all_hint()}>
          {m.workshop_bin_material_scope_all_label()}
        </Tabs.Tab>
        {passes.map((each, index) => (
          <Tabs.Tab key={index} value={String(index)} title={each.pass.shader ?? undefined}>
            {m.workshop_bin_material_scope_pass_label({ number: index + 1 })}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      <Tabs.Panel value={value}>{children}</Tabs.Panel>
    </Tabs.Root>
  );
}
