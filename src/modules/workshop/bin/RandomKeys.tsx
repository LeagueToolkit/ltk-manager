import { CaretDownIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

import { Popover } from "@/components";
import { m } from "@/i18n";

import { channelName, CHIP } from "./curveChannels";
import { type ChannelDraw, neverRolled } from "./randomDraw";
import { factorText, readout } from "./randomText";
import type { ValueFamily } from "./valueRows";

/** A random channel's keys, behind a button at the end of its row. */
export function KeysPopover({ channel, family }: { channel: ChannelDraw; family: ValueFamily }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        /* DS-RADIUS, DS-VEIL */
        className="flex h-5 cursor-pointer items-center gap-0.5 rounded-sm px-1 text-meta text-surface-400 select-none hover:bg-surface-veil hover:text-surface-200"
      >
        {m.workshop_bin_random_keys_action()}
        <CaretDownIcon weight="bold" className="h-3 w-3" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end">
          <Popover.Popup className="flex flex-col gap-1.5 p-2 text-row">
            <Popover.Title className="flex items-baseline gap-1.5 text-meta font-normal text-surface-400">
              {family !== "scalar" && (
                <span
                  /* DS-KIND-HUE, DS-TEXT */
                  className={twMerge("font-mono font-semibold", CHIP[channel.channel] ?? CHIP[0])}
                >
                  {channelName(family, channel.channel)}
                </span>
              )}
              {factorText(channel)}
            </Popover.Title>
            <ChanceTable channel={channel} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A table's keys: the chance, the factor there, and the result where the base holds still. */
function ChanceTable({ channel }: { channel: ChannelDraw }) {
  const { table } = channel;
  if (table === null) return null;
  const base = channel.results === null ? null : channel.base;

  return (
    <table className="w-fit border-separate border-spacing-0 text-left font-mono text-code tabular-nums">
      <thead>
        <tr className="text-meta text-surface-400 select-none">
          <Head>{m.workshop_bin_random_chance_column()}</Head>
          <Head>{m.workshop_bin_random_factor_column()}</Head>
          {base !== null && <Head>{m.workshop_bin_random_result_column()}</Head>}
          <Head />
        </tr>
      </thead>
      <tbody>
        {table.keys.map((key, at) => {
          const factor = key.values[0] ?? table.single;
          const unreached = neverRolled(key.time);
          return (
            <tr
              key={at}
              /* DS-VEIL */
              className={twMerge(
                "text-surface-200 hover:bg-surface-veil-soft",
                unreached && "text-surface-500",
              )}
            >
              <Cell>{key.time.toFixed(3)}</Cell>
              <Cell>{readout(factor)}</Cell>
              {base !== null && <Cell>{readout(factor * base)}</Cell>}
              <td className="px-1.5 py-0.5 font-sans text-meta select-none">
                {unreached && m.workshop_bin_random_never_rolled_label()}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Head({ children }: { children?: ReactNode }) {
  return <th className="px-1.5 py-0.5 font-normal">{children}</th>;
}

function Cell({ children }: { children: ReactNode }) {
  return <td className="px-1.5 py-0.5 select-text">{children}</td>;
}
