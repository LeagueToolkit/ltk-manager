import { commandNames as appUpdate } from "@/lib/ipc/appUpdate";
import { commandNames as atlas } from "@/lib/ipc/atlas";
import { commandNames as bin } from "@/lib/ipc/bin";
import { commandNames as desktop } from "@/lib/ipc/desktop";
import { commandNames as diagnostics } from "@/lib/ipc/diagnostics";
import { commandNames as game } from "@/lib/ipc/game";
import { commandNames as hotkeys } from "@/lib/ipc/hotkeys";
import { commandNames as integrations } from "@/lib/ipc/integrations";
import { commandNames as launcher } from "@/lib/ipc/launcher";
import { commandNames as library } from "@/lib/ipc/library";
import { commandNames as links } from "@/lib/ipc/links";
import { commandNames as news } from "@/lib/ipc/news";
import { commandNames as objects } from "@/lib/ipc/objects";
import { commandNames as patcher } from "@/lib/ipc/patcher";
import { commandNames as preview } from "@/lib/ipc/preview";
import { commandNames as settings } from "@/lib/ipc/settings";
import { commandNames as workshop } from "@/lib/ipc/workshop";

/**
 * The name each command is invoked under, by service and generated function, for a test to
 * match `invoke` calls on. Generated beside the commands (ADR-0059), so a renamed or moved
 * command fails the typecheck.
 */
export const commandNames = {
  appUpdate,
  atlas,
  bin,
  desktop,
  diagnostics,
  game,
  hotkeys,
  integrations,
  launcher,
  library,
  links,
  news,
  objects,
  patcher,
  preview,
  settings,
  workshop,
} as const;
