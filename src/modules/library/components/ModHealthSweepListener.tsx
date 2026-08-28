import { useHealthSweep } from "../api";

/**
 * Watches the startup mod health sweep, and draws nothing of its own.
 *
 * Mounted in the app shell rather than on the library, because the sweep starts
 * with the app and can finish before a library page has ever been opened - the
 * same reason `LibraryMigrationDialog` is mounted there. The drawer it feeds
 * stays the library's; what crosses the app is the progress toast and the
 * refetch when the sweep lands.
 *
 * **Mount this once.** The hook behind it holds the progress subscription, and
 * a second holder would report the run twice over.
 */
export function ModHealthSweepListener() {
  useHealthSweep();
  return null;
}
