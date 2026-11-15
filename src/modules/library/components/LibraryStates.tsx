import { DownloadSimpleIcon } from "@phosphor-icons/react";

import { Button, EmptyState, ErrorState, Skeleton, useConfirm, useToast } from "@/components";
import { m } from "@/i18n";
import type { AppError } from "@/lib/tauri";
import { useLibraryActions, useRebuildNewerIndex } from "@/modules/library/api";
import { hasErrorCode } from "@/utils/errors";

export function LibraryLoadingState() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min-w,240px),var(--card-max-w,320px)))] justify-center gap-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-lg border border-surface-700 bg-surface-800 p-4"
        >
          <Skeleton height="10rem" rounded />
          <Skeleton height="1rem" width="60%" />
          <Skeleton height="0.75rem" width="40%" />
        </div>
      ))}
    </div>
  );
}

export function LibraryErrorState({ error }: { error: AppError }) {
  if (hasErrorCode(error, "SCHEMA_VERSION_TOO_NEW")) {
    return <NewerIndexState error={error} />;
  }

  return <ErrorState error={error} title={m.library_load_failed_title()} />;
}

function NewerIndexState({ error }: { error: AppError }) {
  const confirm = useConfirm();
  const toast = useToast();
  const rebuild = useRebuildNewerIndex();

  async function handleRebuild() {
    const confirmed = await confirm({
      title: m.library_index_rebuild_title(),
      heading: m.library_index_rebuild_heading(),
      description: m.library_index_rebuild_description(),
      confirmLabel: m.library_index_rebuild_action(),
      tone: "warning",
    });
    if (!confirmed) return;

    rebuild.mutate(undefined, {
      onError: (failure) => toast.failure(m.library_index_rebuild_failed_title(), failure),
    });
  }

  return (
    <ErrorState
      error={error}
      tone="warning"
      showCode={false}
      action={
        <Button variant="filled" onClick={handleRebuild} loading={rebuild.isPending}>
          {m.library_index_rebuild_action()}
        </Button>
      }
    />
  );
}

interface LibraryEmptyStateProps {
  hasSearch: boolean;
  hasFilters: boolean;
}

export function LibraryEmptyState({ hasSearch, hasFilters }: LibraryEmptyStateProps) {
  const actions = useLibraryActions();

  if (hasFilters) {
    return (
      <EmptyState
        title={m.library_no_results_title()}
        description={m.library_no_results_filters_description()}
      />
    );
  }

  if (hasSearch) {
    return (
      <EmptyState
        title={m.library_no_results_title()}
        description={m.library_no_results_search_description()}
      />
    );
  }

  return (
    <EmptyState
      icon={<DownloadSimpleIcon className="size-16" />}
      title={m.library_empty_title()}
      description={m.library_empty_description()}
      action={
        <Button
          variant="filled"
          onClick={actions.handleImportMods}
          left={<DownloadSimpleIcon weight="bold" className="size-4" />}
        >
          {m.library_empty_action()}
        </Button>
      }
    />
  );
}
