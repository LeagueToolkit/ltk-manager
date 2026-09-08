import { useMutation } from "@tanstack/react-query";

import { launchMutations } from "./mutations";

/**
 * Call off the launch that is in flight.
 *
 * The launch itself reports `STOPPED`, which `useLaunchErrorToast` deliberately
 * says nothing about.
 */
export function useCancelLaunch() {
  return useMutation(launchMutations.cancel());
}
