import { type KeyboardEvent, useState } from "react";

import { Button, Dialog, TextareaField } from "@/components";
import type { DecodedIncident } from "@/lib/tauri";

import { useDecodeIncidentToken } from "../api";
import {
  describeEnding,
  formatSeconds,
  LAUNCH_LABELS,
  ORIGIN_KIND_LABELS,
  OVERLAY_DETAIL_LABELS,
  OVERLAY_LABELS,
  PHASE_LABELS,
  SCAN_LABELS,
  SCAN_STATUS_LABELS,
} from "../utils/incident";
import { ConsequenceChip } from "./ConsequenceChip";

interface TokenDecoderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The paste box for a token, and the read-only card it unfolds into. A
 * pasted report or bug-report URL decodes the same way, because the backend
 * finds the token inside it, and a refusal shows in the backend's words,
 * which say whether the paste was no token or one from a newer manager.
 */
export function TokenDecoder({ open, onOpenChange }: TokenDecoderProps) {
  const [input, setInput] = useState("");
  const decode = useDecodeIncidentToken();

  const trimmed = input.trim();

  function submit() {
    if (!trimmed) return;
    decode.mutate(trimmed);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setInput("");
      decode.reset();
    }
    onOpenChange(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="lg" data-ui="TokenDecoder">
          <Dialog.Header>
            <Dialog.Title>Decode a token</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body className="flex flex-col gap-4">
            <TextareaField
              name="incident-token"
              label="Token"
              description="A token, or a report or bug-report link with one inside"
              placeholder="DIAG1-…"
              rows={3}
              spellCheck={false}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              textareaClassName="min-h-0 font-mono text-xs"
            />
            <div className="flex items-center justify-between gap-4">
              <span className="flex-1">
                {decode.error && (
                  <p role="alert" className="text-xs text-danger-text">
                    {decode.error.message}
                  </p>
                )}
              </span>
              <Button
                variant="filled"
                size="sm"
                disabled={!trimmed}
                loading={decode.isPending}
                onClick={submit}
              >
                Decode
              </Button>
            </div>
            {decode.data && <DecodedTokenCard incident={decode.data} />}
          </Dialog.Body>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface DecodedTokenCardProps {
  incident: DecodedIncident;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * A token as an incident card, with no actions, because the mods it names
 * are on another machine. The backend has already read every number against
 * its tables, so a value this build does not know arrives as null and the
 * row for it is left out.
 */
export function DecodedTokenCard({ incident }: DecodedTokenCardProps) {
  const facts = [
    `LTK Manager v${incident.manager}`,
    incident.game && `League ${incident.game}`,
    incident.endedAt && new Date(incident.endedAt).toLocaleString(),
    incident.durationSecs !== null && formatSeconds(incident.durationSecs),
    incident.origin && ORIGIN_KIND_LABELS[incident.origin],
  ].filter(isString);

  const overlay = [
    !incident.injected && "DLL never attached",
    incident.injected && incident.overlay && OVERLAY_LABELS[incident.overlay],
    incident.scan && SCAN_LABELS[incident.scan],
    incident.launch && LAUNCH_LABELS[incident.launch],
    incident.hostElevated && "host elevated",
  ]
    .filter(isString)
    .join(", ");

  const binary = (label: string, id: DecodedIncident["dll"]) => {
    if (!id) return null;
    const date = id.built ? new Date(id.built).toLocaleDateString() : null;
    return `${label} ${id.hash}${date ? ` (${date})` : ""}`;
  };
  const patcher = [
    binary("dll", incident.dll),
    binary("host", incident.host),
    incident.patcherOk === true && "stock",
    incident.patcherOk === false && "not this build's",
  ]
    .filter(isString)
    .join(", ");

  const detailLabel = (incident.overlay && OVERLAY_DETAIL_LABELS[incident.overlay]) ?? "Detail";
  const loading =
    incident.lastLoadStep === null
      ? null
      : incident.phase === "loading"
        ? `Stopped at step ${incident.lastLoadStep} of 64`
        : `Last step ${incident.lastLoadStep} of 64`;

  return (
    <section
      data-ui="DecodedTokenCard"
      className="flex flex-col gap-3 rounded-lg border border-surface-700/50 bg-surface-900/95 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-5 items-center rounded-sm border border-accent-500/40 bg-accent-500/10 px-1.5 font-mono text-[10px] font-semibold tracking-wider text-accent-300 uppercase select-none">
          From a token
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-surface-100">{incident.title}</h3>
        {incident.consequence && <ConsequenceChip consequence={incident.consequence} />}
      </div>
      <p className="font-mono text-xs text-surface-400 select-text">{facts.join(" · ")}</p>

      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs select-text">
        {overlay && <Fact label="Overlay" value={overlay} />}
        <Fact
          label="Mods"
          value={`${incident.redirectedCount} archives redirected, ${incident.enabledCount} mods enabled`}
        />
        {patcher && <Fact label="Patcher" value={patcher} />}
        {incident.phase && incident.phase !== "unknown" && (
          <Fact label="Game" value={PHASE_LABELS[incident.phase]} />
        )}
        <Fact label="Ending" value={describeEnding(incident.ending)} />
        {incident.failure && <Fact label="Failure" value={incident.failure} />}
        {incident.overlayDetail && <Fact label={detailLabel} value={incident.overlayDetail} />}
        {incident.scanStatus && (
          <Fact
            label="Scan"
            value={`${SCAN_STATUS_LABELS[incident.scanStatus]} (${incident.scanStatusCode ?? "no code"})`}
          />
        )}
        {incident.subject && <Fact label="Archive" value={incident.subject} />}
        {incident.suspects.length > 0 && (
          <Fact label="Suspects" value={incident.suspects.join(", ")} />
        )}
        {incident.skipped.length > 0 && (
          <Fact
            label="Skipped"
            value={incident.skipped
              .map((skipped) => (skipped.why ? `${skipped.wad} (${skipped.why})` : skipped.wad))
              .join(", ")}
          />
        )}
        {loading && <Fact label="Loading" value={loading} />}
        {incident.missingHash && <Fact label="Missing hash" value={`0x${incident.missingHash}`} />}
      </dl>

      {incident.codes.length > 0 && (
        <ul
          data-ui="DecodedTokenCard:codes"
          className="flex flex-col gap-1 font-mono text-xs select-text"
        >
          {incident.codes.map((code) => (
            <li key={code.id} className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3">
              <span className="text-surface-400">{code.id}</span>
              <span className="break-words text-surface-300">
                {code.meaning ?? "No reading in this build's table"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-surface-500">{label}</dt>
      <dd className="break-words text-surface-300">{value}</dd>
    </>
  );
}
