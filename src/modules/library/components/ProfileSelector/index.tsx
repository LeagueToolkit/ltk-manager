import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Button, Popover, useToast } from "@/components";
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
        <Popover.Trigger
          render={
            <Button
              variant="default"
              size="sm"
              className="group"
              right={
                <ChevronDown className="h-4 w-4 text-surface-400 transition-transform group-data-[popup-open]:rotate-180" />
              }
            />
          }
        >
          {activeProfile?.name || "Default"}
        </Popover.Trigger>

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
