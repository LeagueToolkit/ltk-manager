import { ConfirmDialog, useToast } from "@/components";
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
    } catch {
      /* The default mutation toast reports it. */
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Delete Profile"
      heading={<>Are you sure you want to delete &ldquo;{profile.name}&rdquo;?</>}
      description={
        <>
          This will permanently delete the profile and all its configuration. Any enabled mods in
          this profile will remain installed but will need to be re-enabled in another profile.
        </>
      }
      confirmLabel="Delete Profile"
      onConfirm={handleConfirm}
      pending={deleteProfile.isPending}
      size="md"
    >
      <p className="mt-2 text-xs text-surface-500">This action cannot be undone.</p>
    </ConfirmDialog>
  );
}
