import { SavedImport, Rules } from "./types";
import { validateDraft } from "./validation";
/** No lossy conversion to the demo's fixed 14-shift model. */
export function schedulingInput(saved: SavedImport, rules: Rules) {
  const check = validateDraft(saved.draft, rules);
  if (!check.valid || saved.rulesRevision !== JSON.stringify(rules))
    throw Error("Imported scheduling data requires validation.");
  return {
    source: "import" as const,
    data: check.data,
    rules: structuredClone(rules),
    canOptimize: false as const,
    reason:
      "The demo optimizer does not support imported roles, arbitrary shift windows, or these scheduling rules. An adapter must enforce all of them before optimization is enabled.",
  };
}
