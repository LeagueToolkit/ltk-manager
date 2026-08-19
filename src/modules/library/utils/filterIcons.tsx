import {
  CastleTurretIcon,
  EggIcon,
  GaugeIcon,
  MapTrifoldIcon,
  MegaphoneIcon,
  MountainsIcon,
  PawPrintIcon,
  SpeakerHighIcon,
  SquaresFourIcon,
  TagIcon,
  TextTIcon,
  UserCircleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import {
  AramIcon,
  ArenaIcon,
  EmoteIcon,
  LeagueClassicIcon,
  LeagueIcon,
  LeagueWarningIcon,
  RecallIcon,
  SkinIcon,
  SummonersRiftIcon,
  TftIcon,
  WardIcon,
} from "@/components";

const ICON_CLASS = "h-4 w-4";

/* Riot's own marks where the category has one, phosphor for the rest. */
const TAG_ICONS: Record<string, ReactNode> = {
  "league-of-legends": <LeagueIcon className={ICON_CLASS} />,
  classic: <LeagueClassicIcon className={ICON_CLASS} />,
  tft: <TftIcon className={ICON_CLASS} />,
  "champion-skin": <SkinIcon className={ICON_CLASS} />,
  "map-skin": <MountainsIcon weight="bold" className={ICON_CLASS} />,
  "ward-skin": <WardIcon className={ICON_CLASS} />,
  emote: <EmoteIcon className={ICON_CLASS} />,
  recall: <RecallIcon className={ICON_CLASS} />,
  "summoner-icon": <UserCircleIcon weight="bold" className={ICON_CLASS} />,
  companion: <EggIcon weight="bold" className={ICON_CLASS} />,
  ui: <SquaresFourIcon weight="bold" className={ICON_CLASS} />,
  hud: <GaugeIcon weight="bold" className={ICON_CLASS} />,
  font: <TextTIcon weight="bold" className={ICON_CLASS} />,
  sfx: <SpeakerHighIcon weight="bold" className={ICON_CLASS} />,
  announcer: <MegaphoneIcon weight="bold" className={ICON_CLASS} />,
  structure: <CastleTurretIcon weight="bold" className={ICON_CLASS} />,
  minion: <UsersThreeIcon weight="bold" className={ICON_CLASS} />,
  "jungle-monster": <PawPrintIcon weight="bold" className={ICON_CLASS} />,
  misc: <LeagueWarningIcon className={ICON_CLASS} />,
};

const MAP_ICONS: Record<string, ReactNode> = {
  "summoners-rift": <SummonersRiftIcon className={ICON_CLASS} />,
  aram: <AramIcon className={ICON_CLASS} />,
  arena: <ArenaIcon className={ICON_CLASS} />,
};

/** A mod may declare a tag outside the well-known set, so this falls back. */
export function getTagIcon(tag: string): ReactNode {
  return TAG_ICONS[tag] ?? <TagIcon weight="bold" className={ICON_CLASS} />;
}

/** A mod may declare a map outside the well-known set, so this falls back. */
export function getMapIcon(map: string): ReactNode {
  return MAP_ICONS[map] ?? <MapTrifoldIcon weight="bold" className={ICON_CLASS} />;
}
