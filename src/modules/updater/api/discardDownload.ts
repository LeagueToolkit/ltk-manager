import { useUpdaterStore } from "@/stores";

import { updaterClient } from "./client";

/** Drop a downloaded installer, so quitting installs nothing. */
export async function discardDownload(): Promise<void> {
  useUpdaterStore.getState().dropDownload();

  const result = await updaterClient().discard();
  if (!result.ok) console.error("Dropping the downloaded update failed:", result.error);
}
