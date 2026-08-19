import {
  CheckIcon,
  PencilSimpleIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";

import {
  Button,
  EmptyState,
  Field,
  IconButton,
  ListEditor,
  type ListEditorAction,
  SectionCard,
  useToast,
} from "@/components";
import type { AuthorProfile, Settings } from "@/lib/tauri";

/** A cap the UI imposes on itself - settings will hold as many as it is given. */
const MAX_PROFILES = 5;

interface AuthorProfilesSectionProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

interface Draft {
  id: string;
  name: string;
  role: string;
  /** An unsaved row, so abandoning it drops the row rather than reverting it. */
  isNew: boolean;
}

export function AuthorProfilesSection({ settings, onSave }: AuthorProfilesSectionProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const { toast } = useToast();

  const profiles = settings.authorProfiles ?? [];
  const defaultId = settings.defaultAuthorProfileId;

  /* Undo fires long after the save that armed it, so it reads settings as they are by then. */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const duplicateName = hasDuplicateName(profiles, draft);
  const rows = buildRows(profiles, draft);
  /* Counted off the rows so an unsaved one takes up its place before it is committed. */
  const atLimit = rows.length >= MAX_PROFILES;

  function beginAdd() {
    if (atLimit) return;
    settleDraft();
    setDraft({ id: crypto.randomUUID(), name: "", role: "", isNew: true });
  }

  function beginEdit(profile: AuthorProfile) {
    setDraft({ id: profile.id, name: profile.name, role: profile.role ?? "", isNew: false });
  }

  function commitDraft() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name || duplicateName) return;

    const role = draft.role.trim() || null;
    const updated = draft.isNew
      ? [...profiles, { id: draft.id, name, role }]
      : profiles.map((profile) => (profile.id === draft.id ? { ...profile, name, role } : profile));

    setDraft(null);
    onSave({ ...settings, authorProfiles: updated });
  }

  function settleDraft() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setDraft(null);
      return;
    }
    commitDraft();
  }

  function removeProfile(profile: AuthorProfile) {
    const index = profiles.findIndex((p) => p.id === profile.id);
    const wasDefault = defaultId === profile.id;

    if (draft?.id === profile.id) setDraft(null);
    onSave({
      ...settings,
      authorProfiles: profiles.filter((p) => p.id !== profile.id),
      defaultAuthorProfileId: wasDefault ? null : defaultId,
    });

    toast({
      title: `Removed ${profile.name}`,
      type: "info",
      action: {
        label: "Undo",
        onClick: () => {
          const current = settingsRef.current;
          const restored = [...(current.authorProfiles ?? [])];
          restored.splice(index, 0, profile);
          onSave({
            ...current,
            authorProfiles: restored,
            defaultAuthorProfileId: wasDefault ? profile.id : current.defaultAuthorProfileId,
          });
        },
      },
    });
  }

  function toggleDefault(profile: AuthorProfile) {
    onSave({
      ...settings,
      defaultAuthorProfileId: defaultId === profile.id ? null : profile.id,
    });
  }

  const actions: ListEditorAction<AuthorProfile>[] = [
    {
      placement: "leading",
      icon: (profile) => <DefaultStar active={defaultId === profile.id} />,
      label: (profile) => (defaultId === profile.id ? "Clear default" : "Set as default"),
      pinned: (profile) => defaultId === profile.id,
      onSelect: toggleDefault,
    },
    {
      icon: <PencilSimpleIcon weight="bold" className="h-4 w-4" />,
      label: "Edit",
      onSelect: beginEdit,
    },
    {
      icon: <TrashIcon weight="bold" className="h-4 w-4" />,
      label: "Remove",
      variant: "danger",
      onSelect: removeProfile,
    },
  ];

  return (
    <SectionCard
      title="Author Profiles"
      icon={<UsersThreeIcon className="h-5 w-5" />}
      description="Saved author identities you can reuse across projects."
      action={
        <div className="flex items-center gap-2">
          <ProfileCount used={rows.length} />
          <Button
            variant="outline"
            size="sm"
            left={<PlusIcon weight="bold" className="h-4 w-4" />}
            onClick={beginAdd}
            disabled={atLimit}
          >
            Add Profile
          </Button>
        </div>
      }
    >
      <ListEditor
        items={rows}
        itemKey={(profile) => profile.id}
        editingKey={draft?.id ?? null}
        actions={actions}
        onActivate={beginEdit}
        renderItem={(profile) => (
          <ProfileRow profile={profile} isDefault={defaultId === profile.id} />
        )}
        renderEditor={() => {
          if (!draft) return null;
          return (
            <ProfileEditor
              draft={draft}
              duplicateName={duplicateName}
              onChange={setDraft}
              onCommit={commitDraft}
              onCancel={() => setDraft(null)}
              onSettle={settleDraft}
            />
          );
        }}
        empty={
          <EmptyState
            size="sm"
            title="No profiles yet"
            description="Add your author profile, and use it by default."
            action={
              <Button
                variant="light"
                size="sm"
                left={<PlusIcon weight="bold" className="h-4 w-4" />}
                onClick={beginAdd}
              >
                Add Profile
              </Button>
            }
          />
        }
        footer={<ProfilesHint atLimit={atLimit} hasDefault={!!defaultId} count={rows.length} />}
      />
    </SectionCard>
  );
}

/** The unsaved row renders in place, so it joins the list before it exists in settings. */
function buildRows(profiles: AuthorProfile[], draft: Draft | null): AuthorProfile[] {
  if (!draft?.isNew) return profiles;
  return [...profiles, { id: draft.id, name: draft.name, role: draft.role || null }];
}

function hasDuplicateName(profiles: AuthorProfile[], draft: Draft | null): boolean {
  const name = draft?.name.trim().toLowerCase();
  if (!draft || !name) return false;
  return profiles.some((profile) => profile.id !== draft.id && profile.name.toLowerCase() === name);
}

function ProfileRow({ profile, isDefault }: { profile: AuthorProfile; isDefault: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium text-surface-100 select-text">
          {profile.name}
        </span>
        {isDefault && (
          <span className="shrink-0 rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] font-medium tracking-wide text-accent-300 uppercase">
            Default
          </span>
        )}
      </div>
      <RoleLine role={profile.role} />
    </div>
  );
}

function RoleLine({ role }: { role: string | null }) {
  if (!role) return <span className="truncate text-xs text-surface-500">No role set</span>;
  return <span className="truncate text-xs text-surface-400 select-text">{role}</span>;
}

interface ProfileEditorProps {
  draft: Draft;
  duplicateName: boolean;
  onChange: (draft: Draft) => void;
  onCommit: () => void;
  onCancel: () => void;
  onSettle: () => void;
}

function ProfileEditor({
  draft,
  duplicateName,
  onChange,
  onCommit,
  onCancel,
  onSettle,
}: ProfileEditorProps) {
  const canCommit = !!draft.name.trim() && !duplicateName;

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  function handleBlur(event: React.FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    onSettle();
  }

  return (
    <div className="flex flex-col gap-1" onBlur={handleBlur}>
      <div className="flex items-center gap-2">
        <Field.Control
          autoFocus
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          onKeyDown={handleKeyDown}
          placeholder="Author name"
          hasError={duplicateName}
          className="min-w-0 flex-1"
        />
        <Field.Control
          value={draft.role}
          onChange={(e) => onChange({ ...draft, role: e.target.value })}
          onKeyDown={handleKeyDown}
          placeholder="Role (optional)"
          className="w-44 shrink-0"
        />
        <IconButton
          icon={<CheckIcon weight="bold" className="h-4 w-4" />}
          variant="ghost"
          size="sm"
          compact
          aria-label="Save profile"
          disabled={!canCommit}
          onClick={onCommit}
        />
        <IconButton
          icon={<XIcon weight="bold" className="h-4 w-4" />}
          variant="ghost"
          size="sm"
          compact
          aria-label="Discard changes"
          onClick={onCancel}
        />
      </div>
      {duplicateName && (
        <p className="px-1 text-xs text-danger-text">A profile with that name already exists.</p>
      )}
    </div>
  );
}

function DefaultStar({ active }: { active: boolean }) {
  if (active) return <StarIcon weight="fill" className="h-4 w-4 text-accent-400" />;
  return <StarIcon weight="bold" className="h-4 w-4" />;
}

function ProfileCount({ used }: { used: number }) {
  if (used === 0) return null;
  return (
    <span className="text-xs text-surface-500 tabular-nums">
      {used}/{MAX_PROFILES}
    </span>
  );
}

function ProfilesHint({
  atLimit,
  hasDefault,
  count,
}: {
  atLimit: boolean;
  hasDefault: boolean;
  count: number;
}) {
  if (atLimit) {
    return <p className="px-2 text-xs text-surface-500">Remove a profile to add another.</p>;
  }
  if (hasDefault || count === 0) return null;
  return (
    <p className="px-2 text-xs text-surface-500">
      Set a default profile to fill new projects with it automatically.
    </p>
  );
}
