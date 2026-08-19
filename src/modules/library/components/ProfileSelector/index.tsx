import { CaretDownIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { Button, Popover, TooltipPrimitives as Tooltip, useToast } from "@/components";
import type { Profile } from "@/lib/tauri";
import { useActiveProfile, useProfiles, useSwitchProfile } from "@/modules/library/api";

import { ProfileCreateForm } from "./ProfileCreateForm";
import { ProfileDeleteDialog } from "./ProfileDeleteDialog";
import { ProfileListItem } from "./ProfileListItem";

export function ProfileSelector() {
  const { data: profiles = [] } = useProfiles();
  const { data: activeProfile } = useActiveProfile();
  const switchProfile = useSwitchProfile();
  const toast = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<Profile | null>(null);

  const handleSwitch = async (profileId: string) => {
    try {
      await switchProfile.mutateAsync(profileId);
      setIsOpen(false);
    } catch (error: unknown) {
      toast.error(
        "Failed to switch profile",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  return (
    <>
      <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip.Provider delay={1000}>
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <Popover.Trigger
                  render={
                    <Button
                      variant="default"
                      size="sm"
                      /* Fixed, so switching to a longer-named profile doesn't
                         shove the rest of the toolbar sideways. */
                      className="group w-36 justify-between"
                      right={
                        <CaretDownIcon
                          weight="bold"
                          className="h-4 w-4 text-surface-400 transition-transform group-data-popup-open:rotate-180"
                        />
                      }
                    />
                  }
                >
                  <span className="min-w-0 truncate">{activeProfile?.name || "Default"}</span>
                </Popover.Trigger>
              }
            />
            {!isOpen && (
              <Tooltip.Portal>
                <Tooltip.Positioner side="bottom" sideOffset={8}>
                  <Tooltip.Popup className="max-w-[240px]">
                    <Tooltip.Arrow />
                    <p className="text-xs leading-relaxed text-surface-300">
                      <span className="font-medium text-surface-100">Profiles</span> let you save
                      and switch between different sets of enabled mods. Create multiple profiles
                      for different playstyles or configurations.
                    </p>
                  </Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            )}
          </Tooltip.Root>
        </Tooltip.Provider>

        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start">
            <Popover.Popup className="w-64">
              <div className="max-h-[400px] overflow-y-auto p-1">
                {profiles.map((profile) => (
                  <ProfileListItem
                    key={profile.id}
                    profile={profile}
                    isActive={profile.id === activeProfile?.id}
                    onSwitch={handleSwitch}
                    onDeleteClick={setProfileToDelete}
                    isSwitching={switchProfile.isPending}
                  />
                ))}

                <div className="mt-1 border-t border-surface-700 pt-1">
                  <ProfileCreateForm />
                </div>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <ProfileDeleteDialog
        open={!!profileToDelete}
        profile={profileToDelete}
        onClose={() => setProfileToDelete(null)}
      />
    </>
  );
}
