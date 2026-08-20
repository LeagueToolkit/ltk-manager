import type { EditorDocumentProps } from "@/modules/editor";

import type { ContentDocumentOf } from "../documents/contentDocument";
import { ImagePreview } from "./ImagePreview";

/**
 * One asset, drawn by the viewer its file kind has.
 *
 * Only images have a viewer today. A `.bin` and a mesh join the switch here,
 * and the document, the tab and the reference behind them do not change.
 */
export function PreviewDocument({ document }: EditorDocumentProps<ContentDocumentOf<"preview">>) {
  return <ImagePreview asset={document.asset} name={document.title} />;
}
