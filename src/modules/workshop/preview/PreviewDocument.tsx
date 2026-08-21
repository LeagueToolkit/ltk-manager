import type { EditorDocumentProps } from "@/modules/editor";

import type { ContentDocumentOf } from "../documents/contentDocument";
/* The leaf rather than the gameBrowser barrel, which pulls the documents that
   circle back into this file. */
import { fileKindFromPath } from "../gameBrowser/fileKind";
import { BinPreview, isPropertyBin } from "./BinPreview";
import { ImagePreview } from "./ImagePreview";

/**
 * One asset, drawn by the viewer its file kind has.
 *
 * The kind comes off the name here, which costs nothing and keeps a texture's
 * pixels and its header on their two requests. A chunk no hash table names has
 * no extension to read, so its viewer is settled later, by the bytes.
 */
export function PreviewDocument({ document }: EditorDocumentProps<ContentDocumentOf<"preview">>) {
  if (isPropertyBin(fileKindFromPath(document.title))) {
    return <BinPreview asset={document.asset} name={document.title} />;
  }

  return <ImagePreview asset={document.asset} name={document.title} />;
}
