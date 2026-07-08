import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { twMerge } from "tailwind-merge";

import { AlertBox, Dialog, ExternalLink, Field, Spinner } from "@/components";

import { type LicenseText, type ThirdPartyCrate, useThirdPartyLicenses } from "../api";

interface LicensesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LicensesDialog({ open, onOpenChange }: LicensesDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="xl" className="max-w-3xl">
          <Dialog.Header>
            <div>
              <Dialog.Title>Third-Party Licenses</Dialog.Title>
              <Dialog.Description className="mt-0.5">
                Open source libraries distributed with LTK Manager
              </Dialog.Description>
            </div>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body className="flex h-[60vh] flex-col gap-3 overflow-hidden">
            <LicensesContent open={open} />
          </Dialog.Body>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LicensesContent({ open }: { open: boolean }) {
  const { data: manifest, isLoading, error } = useThirdPartyLicenses(open);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!manifest) return [];
    const q = query.trim().toLowerCase();
    if (!q) return manifest.crates;
    return manifest.crates.filter(
      (crate) =>
        crate.name.toLowerCase().includes(q) ||
        crate.licenses.some((index) => {
          const license = manifest.texts[index];
          return license.id.toLowerCase().includes(q) || license.name.toLowerCase().includes(q);
        }),
    );
  }, [manifest, query]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !manifest) {
    return (
      <AlertBox variant="error" title="Failed to load licenses">
        {error?.message ?? "License manifest is missing from this build."}
      </AlertBox>
    );
  }

  return (
    <>
      <Field.Root className="relative shrink-0">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-surface-500" />
        <Field.Control
          type="text"
          placeholder={`Search ${manifest.crates.length} libraries...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10"
        />
      </Field.Root>
      <div className="-mx-2 flex-1 overflow-y-auto px-2">
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-surface-500">
            No libraries match &quot;{query}&quot;
          </p>
        )}
        <ul className="flex flex-col">
          {filtered.map((crate) => (
            <CrateEntry
              key={`${crate.name}@${crate.version}`}
              crate={crate}
              texts={manifest.texts}
            />
          ))}
        </ul>
      </div>
    </>
  );
}

function CrateEntry({ crate, texts }: { crate: ThirdPartyCrate; texts: LicenseText[] }) {
  const [expanded, setExpanded] = useState(false);

  const licenseIds = [...new Set(crate.licenses.map((index) => texts[index].id))];

  return (
    <li className="border border-surface-600 bg-surface-800/50 first:rounded-t last:rounded-b">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-700/50"
      >
        <ChevronRight
          className={twMerge(
            "h-4 w-4 shrink-0 text-surface-500 transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-surface-100">
          {crate.name}
          <span className="ml-2 font-normal text-surface-500">{crate.version}</span>
        </span>
        <span className="shrink-0 text-xs text-surface-400">{licenseIds.join(", ")}</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-3 border-t border-surface-700 px-3 py-3">
          {crate.url && (
            <ExternalLink href={crate.url} className="self-start text-xs">
              {crate.url}
            </ExternalLink>
          )}
          {crate.licenses.map((index) => (
            <div key={index}>
              <p className="mb-1 text-xs font-medium text-surface-300">{texts[index].name}</p>
              <pre className="rounded-md bg-surface-900/60 p-3 text-xs leading-relaxed whitespace-pre-wrap text-surface-300">
                {texts[index].text}
              </pre>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
