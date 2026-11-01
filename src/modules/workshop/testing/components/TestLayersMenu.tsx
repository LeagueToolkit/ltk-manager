import { CaretDownIcon, PlayIcon } from "@phosphor-icons/react";

import { Button, Menu } from "@/components";
import { m } from "@/i18n";
import type { WorkshopProject } from "@/lib/tauri";
import { useActiveProfile } from "@/modules/library";
import { twMerge } from "@/utils";

import { testedLayers, useExcludedTestLayers, useToggleTestLayer } from "../state/testLayers";

interface TestLayersMenuProps {
  project: Pick<WorkshopProject, "path" | "layers">;
  className?: string;
  onTestOverProfile: () => void;
  disabled?: boolean;
}

/**
 * The layers a test of a project turns on, as a checklist under the caret beside Test.
 *
 * Includes a profile test action even for base-only projects. The caret carries a
 * `tested/total` count while a layer is left out, so a partial test reads before it starts.
 */
export function TestLayersMenu({
  project,
  className,
  onTestOverProfile,
  disabled,
}: TestLayersMenuProps) {
  const { data: activeProfile } = useActiveProfile();
  let profileLabel = m.workshop_test_over_profile_action();
  if (activeProfile)
    profileLabel = m.workshop_test_over_named_profile_action({ profile: activeProfile.name });
  const excluded = useExcludedTestLayers(project.path);
  const toggleLayer = useToggleTestLayer();

  const layers = [...project.layers].sort((a, b) => a.priority - b.priority);
  const tested = testedLayers(project.layers, excluded);

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            data-ui="TestLayersMenu"
            variant="ghost"
            size="sm"
            right={<CaretDownIcon weight="bold" className="size-3.5" />}
            aria-label={m.workshop_test_options_label()}
            className={twMerge("w-auto gap-1 px-1.5 text-xs tabular-nums", className)}
          >
            {tested &&
              m.workshop_test_layers_count_label({
                tested: tested.length,
                total: layers.length,
              })}
          </Button>
        }
      />
      <Menu.Content align="end" className="w-56">
        <Menu.Item
          icon={<PlayIcon className="size-4" />}
          onClick={onTestOverProfile}
          disabled={disabled}
        >
          {profileLabel}
        </Menu.Item>
        {layers.length > 1 && (
          <Menu.Group>
            <Menu.GroupLabel>{m.workshop_test_layers_title()}</Menu.GroupLabel>
            {layers.map((layer) => {
              const isBase = layer.name === "base";

              return (
                <Menu.CheckboxItem
                  key={layer.name}
                  checked={isBase || !excluded.includes(layer.name)}
                  disabled={isBase}
                  onCheckedChange={() => toggleLayer(project.path, layer.name)}
                >
                  {layer.displayName || layer.name}
                </Menu.CheckboxItem>
              );
            })}
          </Menu.Group>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}
