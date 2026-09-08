import { useMutation, useQueryClient } from "@tanstack/react-query";

import { telemetryMutations } from "./mutations";

/** Break the link to everything reported so far, at once rather than at midnight. */
export function useResetTelemetrySecret() {
  return useMutation(telemetryMutations.resetSecret(useQueryClient()));
}
