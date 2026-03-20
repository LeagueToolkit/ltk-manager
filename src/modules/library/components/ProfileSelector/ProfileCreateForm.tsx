import { Check, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, Field, IconButton, useToast } from "@/components";
import { useCreateProfile } from "@/modules/library/api";

export function ProfileCreateForm() {
  const createProfile = useCreateProfile();
  const toast = useToast();

  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating) {
      inputRef.current?.focus();
    }
  }, [isCreating]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || createProfile.isPending) return;

    try {
      await createProfile.mutateAsync(trimmedName);
      setName("");
      setIsCreating(false);
      toast.success("Profile created", `Profile "${trimmedName}" has been created.`);
    } catch (error: unknown) {
      toast.error(
        "Failed to create profile",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setName("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  if (!isCreating) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsCreating(true)}
        left={<Plus className="h-4 w-4" />}
        className="w-full justify-start"
      >
        New Profile
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1 p-1">
      <Field.Control
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        className="h-7 flex-1 px-2 py-1 text-sm"
        placeholder="Profile name..."
      />
      <IconButton
        icon={<Check className="h-4 w-4" />}
        variant="ghost"
        size="xs"
        onClick={handleSubmit}
        disabled={!name.trim() || createProfile.isPending}
        loading={createProfile.isPending}
        className="text-green-400 hover:text-green-300"
      />
      <IconButton
        icon={<X className="h-4 w-4" />}
        variant="ghost"
        size="xs"
        onClick={handleCancel}
      />
    </div>
  );
}
