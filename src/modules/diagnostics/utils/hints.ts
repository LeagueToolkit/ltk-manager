import { m } from "@/i18n";
import type { Hint, Incident, Verdict } from "@/lib/tauri";

/** What a hint's sentence is about beyond the code: the game it was in. */
export type HintContext = Pick<Incident, "redirected">;

/** The sentence for each hint code, exhaustive over the codes. A code without a sentence fails `tsc`. */
const HINT_TEXT: Readonly<Record<Hint, (context: HintContext) => string>> = {
  "system-checks": () => m["hint.system-checks"](),
  "update-manager": () => m["hint.update-manager"](),
  "rebuild-overlay": () => m["hint.rebuild-overlay"](),
  "check-game-path": () => m["hint.check-game-path"](),
  "texture-dimensions": () => m["hint.texture-dimensions"](),
  "repair-install": () => m["hint.repair-install"](),
  "update-driver": () => m["hint.update-driver"](),
  "free-memory": () => m["hint.free-memory"](),
  "open-project": () => m["hint.open-project"](),
  "start-first": () => m["hint.start-first"](),
  "scan-up-front": () => m["hint.scan-up-front"](),
  "copy-report": () => m["hint.copy-report"](),
  "disable-suspect": () => m["hint.disable-suspect"](),
  "remove-skinhack": () => m["hint.remove-skinhack"](),
  "reimport-mod": () => m["hint.reimport-mod"](),
  "repair-game": () => m["hint.repair-game"](),
  elevate: () => m["hint.elevate"](),
  signature: () => m["hint.signature"](),
  "large-textures": ({ redirected }) => m["hint.large-textures"]({ count: redirected.length }),
  "close-game": () => m["hint.close-game"](),
  "shader-definition": () => m["hint.shader-definition"](),
};

/** The sentence a hint code reads as, for the game it was in. */
export function hintText(hint: Hint, context: HintContext): string {
  return HINT_TEXT[hint](context);
}

/** The verdict's hints as sentences, in the verdict's order. */
export function hintTexts(incident: Pick<Incident, "verdict"> & HintContext): string[] {
  return incident.verdict.hints.map((hint) => hintText(hint, incident));
}

/** Whether the verdict asks for a rebuild, which is the one hint with an action. */
export function offersRebuild(verdict: Pick<Verdict, "hints">): boolean {
  return verdict.hints.includes("rebuild-overlay");
}
