import { match } from "ts-pattern";

import { m } from "@/i18n";
import type {
  DeclaredDiagnostic,
  DeclaredDiagnosticKind,
  ObjectSkip,
  SkipReason,
} from "@/lib/tauri";

/** Why a declared key was skipped, for a reader. Every reason `ltk_game_data` names has a line. */
export function skipReasonText(reason: SkipReason): string {
  return match(reason)
    .with("missingObject", () => m.workshop_bin_declared_skip_missing_object())
    .with("missingProperty", () => m.workshop_bin_declared_skip_missing_property())
    .with("nullPointer", () => m.workshop_bin_declared_skip_null_pointer())
    .with("cannotDescend", () => m.workshop_bin_declared_skip_cannot_descend())
    .with("notIndexable", () => m.workshop_bin_declared_skip_not_indexable())
    .with("indexOutOfRange", () => m.workshop_bin_declared_skip_index_out_of_range())
    .with("invalidKey", () => m.workshop_bin_declared_skip_invalid_key())
    .with("keyNotFound", () => m.workshop_bin_declared_skip_key_not_found())
    .with("typeMismatch", () => m.workshop_bin_declared_skip_type_mismatch())
    .with("invalidPath", () => m.workshop_bin_declared_skip_invalid_path())
    .with("untypable", () => m.workshop_bin_declared_skip_untypable())
    .with("unknownClass", () => m.workshop_bin_declared_skip_unknown_class())
    .with("pinMismatch", () => m.workshop_bin_declared_skip_pin_mismatch())
    .with("signOnScalar", () => m.workshop_bin_declared_skip_sign_on_scalar())
    .with("containerAbsent", () => m.workshop_bin_declared_skip_container_absent())
    .with("removalUnmatched", () => m.workshop_bin_declared_skip_removal_unmatched())
    .with("kindMismatch", () => m.workshop_bin_declared_skip_kind_mismatch())
    .with("outOfRange", () => m.workshop_bin_declared_skip_out_of_range())
    .with("precisionLoss", () => m.workshop_bin_declared_skip_precision_loss())
    .with("arityMismatch", () => m.workshop_bin_declared_skip_arity_mismatch())
    .with("referenceMissingEntry", () => m.workshop_bin_declared_skip_reference_missing_entry())
    .with("referenceUnresolved", () => m.workshop_bin_declared_skip_reference_unresolved())
    .with("unknown", () => m.workshop_bin_declared_skip_unknown())
    .exhaustive();
}

/** Why an object's creation or removal was skipped, for a reader. */
export function objectSkipText(reason: ObjectSkip): string {
  return match(reason)
    .with("objectExists", () => m.workshop_bin_declared_object_exists())
    .with("sourceMissing", () => m.workshop_bin_declared_object_source_missing())
    .with("unknownClass", () => m.workshop_bin_declared_object_unknown_class())
    .with("removalUnmatched", () => m.workshop_bin_declared_object_removal_unmatched())
    .with("unknown", () => m.workshop_bin_declared_object_skipped())
    .exhaustive();
}

function kindText(kind: DeclaredDiagnosticKind): string {
  return match(kind)
    .with("overrideUnreadable", () => m.workshop_bin_declared_override_unreadable())
    .with("overrideInvalid", () => m.workshop_bin_declared_override_invalid())
    .with("overrideRecordSkipped", () => m.workshop_bin_declared_override_record_skipped())
    .with("linkRemovalUnmatched", () => m.workshop_bin_declared_link_removal_unmatched())
    .with("propertyEditSkipped", () => m.workshop_bin_declared_skip_unknown())
    .with("schemaFallback", () => m.workshop_bin_declared_schema_fallback())
    .with("referenceUnreadable", () => m.workshop_bin_declared_reference_unreadable())
    .with("objectSkipped", () => m.workshop_bin_declared_object_skipped())
    .with("unknown", () => m.workshop_bin_declared_diagnostic_unknown())
    .exhaustive();
}

/** What a diagnostic says: the skip's reason where it is one, else its category. */
export function diagnosticText(diagnostic: DeclaredDiagnostic): string {
  if (diagnostic.reason !== null) return skipReasonText(diagnostic.reason);
  if (diagnostic.object !== null) return objectSkipText(diagnostic.object);
  return kindText(diagnostic.kind);
}

/** A typing from the game's copy is information. Every other diagnostic lost something. */
export function diagnosticSeverity(diagnostic: DeclaredDiagnostic): "warning" | "info" {
  return diagnostic.kind === "schemaFallback" ? "info" : "warning";
}
