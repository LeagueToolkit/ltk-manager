import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";

import { Button } from "@/components";
import { m } from "@/i18n";
import {
  ConsequenceChip,
  useLatestIncident,
  VerdictGlyph,
  verdictTitle,
} from "@/modules/diagnostics";

import { Tile } from "./Tile";

/** The latest incident's verdict, hidden while there is none or it was dismissed. */
export function LastGameTile() {
  const latest = useLatestIncident();
  const navigate = useNavigate();

  if (!latest) return null;

  return (
    <Tile title={m.home_last_game_title()} data-ui="LastGameTile">
      <div className="flex flex-col gap-2 px-4 pb-4">
        <p className="flex items-center gap-1.5 text-sm font-medium text-surface-100 select-text">
          <VerdictGlyph kind={latest.verdict.kind} className="h-4 w-4 shrink-0" />
          {verdictTitle(latest)}
        </p>
        <div className="flex items-center gap-2 text-xs text-surface-400 select-none">
          <time dateTime={latest.endedAt}>
            {formatDistanceToNow(new Date(latest.endedAt), { addSuffix: true })}
          </time>
          <ConsequenceChip consequence={latest.verdict.consequence} />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            void navigate({
              to: "/diagnostics",
              search: { tab: "games", incident: latest.id },
            })
          }
        >
          {m.home_last_game_review_action()}
        </Button>
      </div>
    </Tile>
  );
}
