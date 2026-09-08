import { open } from "@tauri-apps/plugin-shell";

import { AlertBox, type AlertBoxVariant, Button } from "@/components";
import { m } from "@/i18n";
import type { NoticeSeverity } from "@/lib/tauri";

import { useNotices } from "../api";
import { useHomeStore } from "../state";

const VARIANT: Record<NoticeSeverity, AlertBoxVariant> = {
  info: "info",
  warning: "warning",
  danger: "error",
};

/** Every notice the project has published for this build that the reader has not closed, newest first. */
export function NoticeBanners() {
  const { data: notices } = useNotices();
  const dismissedNoticeIds = useHomeStore((s) => s.dismissedNoticeIds);
  const dismissNotice = useHomeStore((s) => s.dismissNotice);

  const shown = (notices ?? []).filter((notice) => !dismissedNoticeIds.includes(notice.id));
  if (shown.length === 0) return null;

  return (
    <div data-ui="NoticeBanners" className="flex flex-col gap-2">
      {shown.map((notice) => (
        <AlertBox
          key={notice.id}
          variant={VARIANT[notice.severity]}
          title={<span className="select-text">{notice.title}</span>}
          onDismiss={() => dismissNotice(notice.id)}
          actions={notice.url !== null && <WhatToDo url={notice.url} />}
        />
      ))}
    </div>
  );
}

/** The one link a notice carries, opened in the browser. */
function WhatToDo({ url }: { url: string }) {
  return (
    <Button variant="outline" size="sm" onClick={() => void open(url)}>
      {m.home_notice_link_action()}
    </Button>
  );
}
