import { TicketIcon } from "@phosphor-icons/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { AlertBox, Button, EmptyState, Spinner, Tooltip } from "@/components";

import { useIncidents } from "../api";
import { IncidentDetail } from "./IncidentDetail";
import { IncidentList } from "./IncidentList";
import { TokenDecoder } from "./TokenDecoder";

const EMPTY_COPY =
  "No game has gone wrong while the patcher ran. When one does, what the manager learned about it lands here.";

const DECODE_LABEL = "Decode a token";

/**
 * The incident list beside the selected incident's detail. The selection is
 * the route's `incident` search param, so a toast, a badge or the session bar
 * lands on the same row this tab draws, and it falls back to the newest.
 *
 * The list is a rail against the window edge and the detail is a reading
 * column inside the rest, so a fullscreen window widens the margins rather
 * than the prose.
 */
export function GamesTab() {
  const incidents = useIncidents();
  const { incident: requestedId } = useSearch({ from: "/diagnostics" });
  const navigate = useNavigate({ from: "/diagnostics" });
  const [decoderOpen, setDecoderOpen] = useState(false);

  const list = incidents.data ?? [];
  const selected = list.find((incident) => incident.id === requestedId) ?? list[0] ?? null;

  function select(id: string) {
    navigate({ search: (prev) => ({ ...prev, incident: id }), replace: true });
  }

  if (incidents.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (incidents.isError) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6">
        <AlertBox variant="error" title="Couldn't read the incidents">
          {incidents.error.message}
        </AlertBox>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div data-ui="GamesTab" className="flex flex-1 flex-col items-center justify-center p-6">
        <EmptyState
          title="No incidents"
          description={EMPTY_COPY}
          action={
            <Button
              variant="ghost"
              size="sm"
              left={<TicketIcon weight="bold" className="h-4 w-4" />}
              onClick={() => setDecoderOpen(true)}
            >
              {DECODE_LABEL}
            </Button>
          }
        />
        <TokenDecoder open={decoderOpen} onOpenChange={setDecoderOpen} />
      </div>
    );
  }

  const countLabel = list.length === 1 ? "1 incident" : `${list.length} incidents`;

  return (
    <div data-ui="GamesTab" className="flex min-h-0 flex-1">
      <aside
        data-ui="GamesTab:list"
        className="flex w-72 shrink-0 flex-col border-r border-surface-700/50 bg-surface-950 xl:w-80"
      >
        <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-surface-700/50 pr-1.5 pl-3 select-none">
          <p className="font-mono text-[11px] tracking-wide text-surface-400 tabular-nums">
            {countLabel}
          </p>
          <Tooltip content={DECODE_LABEL}>
            <Button
              variant="ghost"
              size="sm"
              compact
              aria-label={DECODE_LABEL}
              left={<TicketIcon weight="bold" className="h-4 w-4" />}
              onClick={() => setDecoderOpen(true)}
            />
          </Tooltip>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <IncidentList incidents={list} selectedId={selected?.id ?? null} onSelect={select} />
        </div>
      </aside>
      <div data-ui="GamesTab:detail" className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl p-6">
          {selected && <IncidentDetail key={selected.id} incident={selected} />}
        </div>
      </div>
      <TokenDecoder open={decoderOpen} onOpenChange={setDecoderOpen} />
    </div>
  );
}
