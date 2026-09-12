import { memo } from "react";

import { ModCardGrid } from "./ModCardGrid";
import { ModCardList } from "./ModCardList";
import { type ModCardProps, useModCardController } from "./useModCardController";

/* Memoised because a drag re-renders every card's sortable wrapper each time the
   target changes, and the card under it is the expensive half. Every prop is
   stable per card, since the mod comes from the query cache. */
export const ModCard = memo(function ModCard(props: ModCardProps) {
  const view = useModCardController(props);

  if (props.viewMode === "list") return <ModCardList view={view} />;
  return <ModCardGrid view={view} />;
});
