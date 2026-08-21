import { type KeyboardEvent, useState } from "react";

import { Button, Dialog, TextareaField } from "@/components";
import type { IncidentToken } from "@/lib/tauri";

import { useDecodeIncidentToken } from "../api";
import {
  describeEnding,
  formatSeconds,
  TOKEN_VERDICT_TITLES,
  tokenConsequence,
} from "../utils/incident";
import { ConsequenceChip } from "./ConsequenceChip";

const NOT_A_TOKEN = "Not an LTK incident token.";

interface TokenDecoderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The paste box for a token, and the read-only card it unfolds into. A
 * pasted report or bug-report URL decodes the same way, because the backend
 * finds the token inside it.
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
              placeholder="LTK1-…"
              rows={3}
              spellCheck={false}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              textareaClassName="min-h-0 font-mono text-xs"
            />
            <div className="flex items-center justify-between gap-4">
              <span className="flex-1">
                {decode.isError && (
                  <p role="alert" className="text-xs text-danger-text">
                    {NOT_A_TOKEN}
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
            {decode.data && <DecodedTokenCard token={decode.data} />}
          </Dialog.Body>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface DecodedTokenCardProps {
  token: IncidentToken;
}

/**
 * A token as an incident card, with no actions, because the mods it names
 * are on another machine. Codes show as they are, since the token carries
 * them as strings and the local table is not consulted here.
 */
export function DecodedTokenCard({ token }: DecodedTokenCardProps) {
  const title = TOKEN_VERDICT_TITLES[token.verdict] ?? `Verdict ${token.verdict}`;
  const consequence = tokenConsequence(token.verdict);
  const endedAt = new Date(token.endedAt * 60_000);

  const facts = [
    `LTK Manager v${token.manager.join(".")}`,
    token.game && `League ${token.game.join(".")}`,
    endedAt.toLocaleString(),
    token.durationSecs !== null && formatSeconds(token.durationSecs),
  ].filter((fact): fact is string => typeof fact === "string");

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
        <h3 className="text-base font-semibold text-surface-100">{title}</h3>
        {consequence && <ConsequenceChip consequence={consequence} />}
      </div>
      <p className="font-mono text-xs text-surface-400 select-text">{facts.join(" · ")}</p>

      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs select-text">
        <Fact label="Ending" value={describeEnding(token)} />
        {token.suspects.length > 0 && <Fact label="Suspects" value={token.suspects.join(", ")} />}
        {token.archives.length > 0 && <Fact label="Archives" value={token.archives.join(", ")} />}
        {token.skipped.length > 0 && <Fact label="Skipped" value={token.skipped.join(", ")} />}
        {token.lastLoadStep !== null && (
          <Fact label="Loading" value={`Stopped at step ${token.lastLoadStep} of 64`} />
        )}
        {token.missingHash && <Fact label="Missing hash" value={`0x${token.missingHash}`} />}
        <Fact
          label="Overlay"
          value={`${token.redirectedCount} archives redirected, ${token.enabledCount} mods enabled`}
        />
        {token.errorLines > 0 && (
          <Fact label="Game log" value={`${token.errorLines} error lines`} />
        )}
        {token.hostFailure && <Fact label="Host" value={token.hostFailure} />}
      </dl>

      {token.codes.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {token.codes.map((code) => (
            <li
              key={code}
              className="rounded-sm border border-surface-600 bg-surface-800 px-1.5 py-0.5 font-mono text-[10px] text-surface-300 select-text"
            >
              {code}
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
