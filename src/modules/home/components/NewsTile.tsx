import {
  BookOpenIcon,
  DiscordLogoIcon,
  GithubLogoIcon,
  type Icon,
  LifebuoyIcon,
  StackIcon,
} from "@phosphor-icons/react";

import { Button, ExternalLink } from "@/components";
import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { useAnnouncements } from "../api";
import { Tile } from "./Tile";

/** How many posts the card has room for. The link under them is the rest. */
const POSTS_SHOWN = 5;

const WIKI = "https://wiki.leaguetoolkit.dev";
const DISCORD = "https://discord.gg/yhzDVRyQex";
const REPOSITORY = "https://github.com/LeagueToolkit/ltk-manager";

/** A standing link: what it is called, what it is drawn with, and where it opens. */
interface StandingLink {
  label: () => string;
  icon: Icon;
  href: string;
}

/** The standing links, so the card is never empty. */
const LEARN_LINKS: StandingLink[] = [
  {
    label: () => m.home_learn_getting_started_label(),
    icon: BookOpenIcon,
    href: `${WIKI}/start-here/`,
  },
  {
    label: () => m.home_learn_managing_mods_label(),
    icon: StackIcon,
    href: `${WIKI}/mod-management/`,
  },
  {
    label: () => m.home_learn_troubleshooting_label(),
    icon: LifebuoyIcon,
    href: `${WIKI}/start-here/faq/`,
  },
];

/** The project's posts, then the links that stand whether or not it has posted. */
export function NewsTile() {
  const { data: posts, error, refetch } = useAnnouncements();
  const shown = (posts ?? []).slice(0, POSTS_SHOWN);

  return (
    <Tile
      title={m.home_news_title()}
      data-ui="NewsTile"
      action={
        error !== null && (
          <Button variant="ghost" size="xs" compact onClick={() => void refetch()}>
            {m.common_retry_action()}
          </Button>
        )
      }
      foot={<Community />}
    >
      <div className="flex flex-col gap-3 px-2 pb-2">
        {shown.length > 0 && (
          <ul data-ui="NewsTile:posts" className="flex flex-col">
            {shown.map((post) => (
              <li key={post.id}>
                <ExternalLink
                  href={post.url}
                  hideIcon
                  className="flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-surface-200 hover:bg-surface-800/60 hover:text-accent-300"
                >
                  <span className="line-clamp-2 text-sm leading-snug">{post.title}</span>
                  <time
                    dateTime={post.publishedAt ?? undefined}
                    className="text-xs text-surface-500 tabular-nums select-none"
                  >
                    {postDate(post.publishedAt)}
                  </time>
                </ExternalLink>
              </li>
            ))}
          </ul>
        )}

        <nav
          data-ui="NewsTile:learn"
          className={twMerge(
            "flex flex-col select-none",
            shown.length > 0 && "border-t border-surface-700/50 pt-2",
          )}
        >
          {LEARN_LINKS.map(({ label, icon: Glyph, href }) => (
            <ExternalLink
              key={href}
              href={href}
              hideIcon
              className="gap-2 rounded-md px-2 py-1.5 text-sm text-surface-200 hover:bg-surface-800/60 hover:text-accent-300"
            >
              <Glyph className="h-4 w-4 shrink-0 text-surface-400" />
              {label()}
            </ExternalLink>
          ))}
        </nav>
      </div>
    </Tile>
  );
}

/** Where the project answers, as two presses rather than two more links. */
function Community() {
  return (
    <div data-ui="NewsTile:community" className="grid grid-cols-2 gap-2">
      <Button
        variant="ghost"
        size="sm"
        left={<DiscordLogoIcon weight="duotone" className="h-4 w-4" />}
        onClick={() => void open(DISCORD)}
      >
        {m.home_learn_discord_label()}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        left={<GithubLogoIcon weight="duotone" className="h-4 w-4" />}
        onClick={() => void open(REPOSITORY)}
      >
        {m.home_learn_repository_label()}
      </Button>
    </div>
  );
}

/** The day a post went up, short, or nothing for a post without one. */
function postDate(publishedAt: string | null): string {
  if (!publishedAt) return "";
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
