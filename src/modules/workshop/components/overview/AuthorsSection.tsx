import { Plus, Trash2, Users } from "lucide-react";

import { Button, FormField, IconButton, SectionCard } from "@/components";
import type { WorkshopAuthor } from "@/lib/tauri";

interface AuthorsSectionProps {
  authors: WorkshopAuthor[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: "name" | "role", value: string) => void;
}

export function AuthorsSection({ authors, onAdd, onRemove, onUpdate }: AuthorsSectionProps) {
  return (
    <SectionCard
      title="Authors"
      icon={<Users className="h-4 w-4" />}
      description="People who contributed to this mod."
      action={
        <Button variant="outline" size="sm" left={<Plus className="h-4 w-4" />} onClick={onAdd}>
          Add Author
        </Button>
      }
    >
      {authors.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1 text-xs font-medium text-surface-400">
            <div className="flex-1">Name</div>
            <div className="w-48">Role</div>
            <div className="w-9" />
          </div>

          {authors.map((author, index) => (
            <div key={index} className="flex items-center gap-2">
              <FormField
                value={author.name}
                onChange={(e) => onUpdate(index, "name", e.target.value)}
                placeholder="Author name"
                className="flex-1"
              />
              <FormField
                value={author.role ?? ""}
                onChange={(e) => onUpdate(index, "role", e.target.value)}
                placeholder="e.g. 3D Artist"
                className="w-48"
              />
              <IconButton
                icon={<Trash2 className="h-4 w-4" />}
                variant="ghost"
                size="sm"
                onClick={() => onRemove(index)}
              />
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
