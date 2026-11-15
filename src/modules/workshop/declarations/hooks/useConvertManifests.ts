import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useToast } from "@/components";
import { m } from "@/i18n";
import { api } from "@/lib/tauri";

import { workshopKeys } from "../../shared/api/keys";

/**
 * Converts the JSON and TOML game data of the project at `projectPath` to YAML when it opens.
 *
 * Calls the command directly, since a mutation fired from a mount effect does not resolve under
 * StrictMode. A second call in a mount finds nothing left to convert.
 */
export function useConvertManifests(projectPath: string): void {
  const client = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    void api.declarations.convert(projectPath).then((result) => {
      if (!result.ok) {
        toast.failure(m.workshop_declarations_conversion_failed_title(), result.error);
        return;
      }

      if (result.value.converted.length > 0) {
        void client.invalidateQueries({ queryKey: workshopKeys.project(projectPath) });
      }

      for (const { layer, message } of result.value.failed) {
        toast.error(
          m.workshop_declarations_conversion_failed_title(),
          m.workshop_declarations_conversion_failed_description({ layer, message }),
        );
      }
    });
  }, [client, projectPath, toast]);
}
