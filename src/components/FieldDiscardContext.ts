import { createContext } from "react";

/** What an edit field calls when `Escape` drops its draft, such as clearing a refusal mark. */
export const FieldDiscardContext = createContext<(() => void) | null>(null);
