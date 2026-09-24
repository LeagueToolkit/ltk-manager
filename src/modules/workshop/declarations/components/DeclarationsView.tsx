import { BracketsCurlyIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { EmptyState, Spinner } from "@/components";
import { m } from "@/i18n";

import { declarationsDocument } from "../../documents/utils/contentDocument";
import type { OpenIntent } from "../../palette/utils/types";
import { useProjectContext } from "../../projects/state/ProjectContext";
import { useOpenDocumentAs } from "../../state";
import { declarationQueries } from "../api/queries";
import { useRevealOutlineItem } from "../state/outlineReveal";
import type { OutlineNode, OutlineShape } from "../utils/outlineTree";
import { DeclarationsTree } from "./DeclarationsTree";

const VIEW_SHAPE: OutlineShape = { layers: true, keys: false };

/**
 * The project's declarations as a rail view: layers, their modules, and the entries each
 * declares, with a count on every row. A click opens the layer's document on that item.
 */
export function DeclarationsView() {
  const project = useProjectContext();
  const outline = useQuery(declarationQueries.outline(project.path));
  const open = useOpenDocumentAs();
  const reveal = useRevealOutlineItem();

  const openAt = useCallback(
    (node: OutlineNode, intent: OpenIntent) => {
      const layer = node.type === "layer" ? node.layer.layer : node.layer;
      const document = declarationsDocument(layer);
      open(document, intent);
      if (node.type !== "layer") reveal(document.id, node.id);
    },
    [open, reveal],
  );

  if (outline.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const layers = outline.data ?? [];
  if (!layers.some((layer) => layer.file !== null)) {
    return (
      <EmptyState
        size="sm"
        icon={<BracketsCurlyIcon className="h-8 w-8" />}
        title={m.workshop_declarations_view_empty_title()}
        description={m.workshop_declarations_view_empty_description()}
      />
    );
  }

  return (
    <DeclarationsTree
      layers={layers}
      shape={VIEW_SHAPE}
      ariaLabel={m.workshop_sidebar_declarations_title()}
      onOpen={openAt}
      openBranches
    />
  );
}
