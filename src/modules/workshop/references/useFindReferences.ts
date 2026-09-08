import { useCallback } from "react";

import { referencesDocument } from "../documents/contentDocument";
import { type ReferenceRequest, useAskReferences, useOpenDocument } from "../state";

/** Every object of one class, labelled by the class name or its hash. */
export function classReferences(classHash: string, name: string | null): ReferenceRequest {
  return { query: { kind: "class", classHash }, label: name ?? classHash };
}

/** Every declaration of one object, labelled by the object's path. */
export function objectReferences(objectHash: string, objectPath: string): ReferenceRequest {
  return { query: { kind: "object", objectHash }, label: objectPath };
}

/**
 * Open the References document on a new question, which replaces the last.
 *
 * "The References document" in docs/ux/PROJECT_EDITOR.md. Find all references on a class
 * card and Find references on an object menu both come through here.
 */
export function useFindReferences(): (request: ReferenceRequest) => void {
  const openDocument = useOpenDocument();
  const ask = useAskReferences();

  return useCallback(
    (request) => {
      ask(request);
      openDocument(referencesDocument());
    },
    [ask, openDocument],
  );
}
