import { TriangleAlert } from "lucide-react";

import { Button, Dialog, useToast } from "@/components";
import type { Profile } from "@/lib/tauri";
import { useDeleteProfile } from "@/modules/library/api";

interface ProfileDeleteDialogProps {
  open: boolean;
  profile: Profile | null;
  onClose: () => void;
}

export function ProfileDeleteDialog({ open, profile, onClose }: ProfileDeleteDialogProps) {
  const deleteProfile = useDeleteProfile();
  const toast = useToast();

  if (!profile) return null;

  const handleConfirm = async () => {
    try {
      await deleteProfile.mutateAsync(profile.id);
      onClose();
      toast.success("Profile deleted");
    } catch (error: unknown) {
      toast.error(
        "Failed to delete profile",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay>
          <Dialog.Header>
            <Dialog.Title>Delete Profile</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>

          <Dialog.Body>
            <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger-text" />
              <div>
                <h3 className="font-medium text-danger-text">
                  Are you sure you want to delete &ldquo;{profile.name}&rdquo;?
                </h3>
                <p className="mt-1 text-sm text-surface-400">
                  This will permanently delete the profile and all its configuration. Any enabled
                  mods in this profile will remain installed but will need to be re-enabled in
                  another profile.
                </p>
                <p className="mt-2 text-xs text-surface-500">This action cannot be undone.</p>
              </div>
            </div>
          </Dialog.Body>

          <Dialog.Footer>
            <Button variant="ghost" onClick={onClose} disabled={deleteProfile.isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleConfirm} loading={deleteProfile.isPending}>
              Delete Profile
            </Button>
          </Dialog.Footer>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
