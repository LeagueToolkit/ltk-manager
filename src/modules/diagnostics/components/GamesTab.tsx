import { TicketIcon } from "@phosphor-icons/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { AlertBox, Button, EmptyState, Spinner } from "@/components";

import { useIncidents } from "../api";
import { IncidentDetail } from "./IncidentDetail";
import { IncidentList } from "./IncidentList";
import { TokenDecoder } from "./TokenDecoder";

const EMPTY_COPY =
  "No game has gone wrong while the patcher ran. When one does, what the manager learned about it lands here.";

/**
 * The incident list beside the selected incident's detail. The selection is
 * the route's `incident` search param, so a toast, a badge or the session bar
 * lands on the same row this tab draws, and it falls back to the newest.
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

  const decodeButton = (
    <Button
      variant="ghost"
      size="sm"
      left={<TicketIcon weight="bold" className="h-4 w-4" />}
      onClick={() => setDecoderOpen(true)}
    >
      Decode a token
    </Button>
  );

  if (incidents.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (incidents.isError) {
    return (
      <div className="p-6">
        <AlertBox variant="error" title="Couldn't read the incidents">
          {incidents.error.message}
        </AlertBox>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div data-ui="GamesTab" className="flex flex-1 flex-col items-center justify-center p-6">
        <EmptyState title="No incidents" description={EMPTY_COPY} action={decodeButton} />
        <TokenDecoder open={decoderOpen} onOpenChange={setDecoderOpen} />
      </div>
    );
  }

  const countLabel = list.length === 1 ? "1 incident" : `${list.length} incidents`;

  return (
    <div data-ui="GamesTab" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 px-6 py-2 select-none">
        <p className="text-xs text-surface-500">{countLabel}</p>
        {decodeButton}
      </div>
      <div className="flex min-h-0 flex-1 border-t border-surface-700/50">
        <aside
          data-ui="GamesTab:list"
          className="w-[260px] shrink-0 overflow-y-auto border-r border-surface-700/50 p-3"
        >
          <IncidentList incidents={list} selectedId={selected?.id ?? null} onSelect={select} />
        </aside>
        <div data-ui="GamesTab:detail" className="min-w-0 flex-1 overflow-y-auto p-6">
          {selected && <IncidentDetail key={selected.id} incident={selected} />}
        </div>
      </div>
      <TokenDecoder open={decoderOpen} onOpenChange={setDecoderOpen} />
    </div>
  );
}
