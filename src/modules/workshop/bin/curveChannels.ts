import type { ValueFamily } from "./valueRows";

/** What each channel of a family is called, in the letters both of Riot's editors use. */
export const CHANNELS: Record<ValueFamily, readonly string[]> = {
  scalar: ["value"],
  vector: ["X", "Y", "Z"],
  color: ["R", "G", "B", "A"],
};

/** The hue each channel draws in, X red, Y green and Z blue as Riot draws them. DS-KIND-HUE. */
export const STROKE = [
  "text-channel-1",
  "text-channel-2",
  "text-channel-3",
  "text-channel-4",
] as const;

/** The same hues as a label, per DS-TEXT. */
export const CHIP = [
  "text-channel-1-text",
  "text-channel-2-text",
  "text-channel-3-text",
  "text-channel-4-text",
] as const;

/** What `channel` is called on a `family`, falling back to its own index. */
export function channelName(family: ValueFamily, channel: number): string {
  return CHANNELS[family][channel] ?? String(channel);
}
