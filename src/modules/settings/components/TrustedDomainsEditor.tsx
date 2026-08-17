import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { Button, Field, IconButton } from "@/components";
import type { Settings } from "@/lib/tauri";

interface TrustedDomainsEditorProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
}

export function TrustedDomainsEditor({ settings, onSave }: TrustedDomainsEditorProps) {
  const [newDomain, setNewDomain] = useState("");

  const domains = settings.trustedDomains ?? [];

  function addDomain() {
    const trimmed = newDomain.trim().toLowerCase();
    if (!trimmed || domains.includes(trimmed)) return;
    onSave({ ...settings, trustedDomains: [...domains, trimmed] });
    setNewDomain("");
  }

  function removeDomain(domain: string) {
    onSave({ ...settings, trustedDomains: domains.filter((d) => d !== domain) });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      addDomain();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-xl text-sm text-surface-400">
        One-click links only install from these domains. Remove all of them to allow any source.
      </p>

      {domains.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {domains.map((domain) => (
            <div
              key={domain}
              className="flex items-center justify-between rounded-md bg-surface-800 px-3 py-2"
            >
              <span className="font-mono text-sm text-surface-200">{domain}</span>
              <IconButton
                icon={<XIcon weight="bold" className="h-3.5 w-3.5" />}
                variant="ghost"
                size="xs"
                compact
                aria-label={`Remove ${domain}`}
                onClick={() => removeDomain(domain)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Field.Control
          type="text"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. example.com"
          className="min-w-0 flex-1"
        />
        <Button
          variant="outline"
          size="sm"
          left={<PlusIcon weight="bold" className="h-4 w-4" />}
          onClick={addDomain}
          disabled={!newDomain.trim()}
          className="shrink-0"
        >
          Add
        </Button>
      </div>
    </div>
  );
}
