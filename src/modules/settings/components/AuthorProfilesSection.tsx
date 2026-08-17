import { PlusIcon, StarIcon, TrashIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { useDebounceCallback } from "usehooks-ts";

import { Button, EmptyState, Field, IconButton, SectionCard } from "@/components";
import type { AuthorProfile, Settings } from "@/lib/tauri";

interface AuthorProfilesSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function AuthorProfilesSection({ settings, onSave }: AuthorProfilesSectionProps) {
  const [localProfiles, setLocalProfiles] = useState<AuthorProfile[]>(
    settings.authorProfiles ?? [],
  );
  const defaultId = settings.defaultAuthorProfileId;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const debouncedSave = useDebounceCallback((profiles: AuthorProfile[]) => {
    onSave({ ...settingsRef.current, authorProfiles: profiles });
  }, 300);

  function saveImmediately(profiles: AuthorProfile[], extra?: Partial<Settings>) {
    debouncedSave.cancel();
    onSave({ ...settings, authorProfiles: profiles, ...extra });
  }

  function addProfile() {
    const newProfile: AuthorProfile = {
      id: crypto.randomUUID(),
      name: "",
      role: null,
    };
    const updated = [...localProfiles, newProfile];
    setLocalProfiles(updated);
    saveImmediately(updated);
  }

  function removeProfile(id: string) {
    const updated = localProfiles.filter((p) => p.id !== id);
    setLocalProfiles(updated);
    saveImmediately(updated, defaultId === id ? { defaultAuthorProfileId: null } : undefined);
  }

  function updateProfile(id: string, field: "name" | "role", value: string) {
    const updated = localProfiles.map((p) =>
      p.id === id ? { ...p, [field]: field === "role" && !value ? null : value } : p,
    );
    setLocalProfiles(updated);
    debouncedSave(updated);
  }

  function flushProfile(id: string, field: "name" | "role", value: string) {
    const trimmed = value.trim();
    const updated = localProfiles.map((p) =>
      p.id === id ? { ...p, [field]: field === "role" && !trimmed ? null : trimmed } : p,
    );
    setLocalProfiles(updated);
    saveImmediately(updated);
  }

  function toggleDefault(id: string) {
    debouncedSave.cancel();
    onSave({
      ...settings,
      authorProfiles: localProfiles,
      defaultAuthorProfileId: defaultId === id ? null : id,
    });
  }

  return (
    <SectionCard
      title="Author Profiles"
      icon={<UsersThreeIcon className="h-5 w-5" />}
      description="Saved author identities you can reuse across projects."
      action={
        <Button
          variant="outline"
          size="sm"
          left={<PlusIcon weight="bold" className="h-4 w-4" />}
          onClick={addProfile}
        >
          Add Profile
        </Button>
      }
    >
      {localProfiles.length === 0 && (
        <EmptyState
          size="sm"
          title="No profiles yet"
          description="Add your author profile, and use it by default."
        />
      )}

      {localProfiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1 text-xs font-medium text-surface-400">
            <div className="w-8" />
            <div className="flex-1">Name</div>
            <div className="w-40">Role</div>
            <div className="w-9" />
          </div>

          {localProfiles.map((profile) => (
            <div key={profile.id} className="flex items-center gap-2">
              <IconButton
                icon={<DefaultStar active={defaultId === profile.id} />}
                variant="ghost"
                size="sm"
                aria-label="Toggle default profile"
                onClick={() => toggleDefault(profile.id)}
              />
              <Field.Control
                value={profile.name}
                onChange={(e) => updateProfile(profile.id, "name", e.target.value)}
                onBlur={(e) => flushProfile(profile.id, "name", e.target.value)}
                placeholder="Author name"
                className="min-w-0 flex-1"
              />
              <Field.Control
                value={profile.role ?? ""}
                onChange={(e) => updateProfile(profile.id, "role", e.target.value)}
                onBlur={(e) => flushProfile(profile.id, "role", e.target.value)}
                placeholder="e.g. 3D Artist"
                className="w-40 shrink-0"
              />
              <IconButton
                icon={<TrashIcon weight="bold" className="h-4 w-4" />}
                variant="ghost"
                size="sm"
                aria-label="Remove profile"
                onClick={() => removeProfile(profile.id)}
              />
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function DefaultStar({ active }: { active: boolean }) {
  if (active) return <StarIcon weight="fill" className="h-4 w-4 text-accent-400" />;
  return <StarIcon weight="bold" className="h-4 w-4" />;
}
