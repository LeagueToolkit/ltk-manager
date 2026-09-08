import { useQuery } from "@tanstack/react-query";

import { settingsQueries } from "./queries";

export type {
  LicenseText,
  ThirdPartyCrate,
  ThirdPartyLicensesManifest,
} from "./thirdPartyLicenses";

/** The bundled license manifest, read only once a panel asks for it. */
export function useThirdPartyLicenses(enabled: boolean) {
  return useQuery({ ...settingsQueries.thirdPartyLicenses(), enabled });
}
