import { m } from "@/i18n";
import type { ReportOrigin } from "@/lib/tauri";

/** The two lines that the dialog shows for the origin of a report. */
export interface OriginCopy {
  title: string;
  /** The facts of the origin, which the dialog shows as data. */
  detail: string;
}

/** Returns the title and the facts of `origin`, as the dialog shows them. */
export function describeOrigin(origin: ReportOrigin): OriginCopy {
  switch (origin.kind) {
    case "crash":
      return {
        title: m.support_origin_crash_title({ route: origin.route }),
        detail: origin.message,
      };
    case "panic":
      return {
        title: m.support_origin_panic_title(),
        detail: m.support_origin_panic_description({
          time: new Date(origin.panic.at).toLocaleString(),
          version: origin.panic.version,
        }),
      };
    case "error": {
      const { title, code, kind, ref } = origin.error;
      return { title, detail: [code, kind, ref].filter((part) => part !== null).join(" · ") };
    }
  }
}
