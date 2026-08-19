import type { ComponentType, ReactNode } from "react";

/** The least a surface needs to know about what it is showing. */
export interface EditorDocumentBase {
  id: string;
  kind: string;
}

export interface EditorTabLabel {
  title: string;
  /** Dim text after the title, saying where the document lives. */
  context?: string;
}

export interface EditorDocumentProps<D extends EditorDocumentBase> {
  document: D;
  /** This document is the one on screen. Editors bind their shortcuts on it. */
  active: boolean;
}

export interface EditorDocumentDefinition<D extends EditorDocumentBase> {
  icon: (document: D) => ReactNode;
  label: (document: D) => EditorTabLabel;
  component: ComponentType<EditorDocumentProps<D>>;
}

/** The editors a surface can host, one per document kind. */
export type EditorRegistry<D extends EditorDocumentBase> = {
  [K in D["kind"]]: EditorDocumentDefinition<Extract<D, { kind: K }>>;
};
