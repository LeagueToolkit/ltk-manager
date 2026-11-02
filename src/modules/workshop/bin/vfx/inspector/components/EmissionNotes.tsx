import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { m } from "@/i18n";
import { viewportQueries } from "@/modules/viewport";

import { useForces } from "../../forces/useForces";
import { useHostSkin } from "../../preview/components/VfxHost";
import { useEmitters } from "../state/emitterChoice";
import { useEmitterModel } from "../state/emitterModel";
import { type CheckGroup, type EmissionCheck, emissionChecks } from "../utils/emissionChecks";
import { NoteList } from "./NoteList";

const NO_CHECKS: readonly EmissionCheck[] = [];

/** The emission checks that the inspector's emitter fails. */
export function useEmissionChecks(): readonly EmissionCheck[] {
  const { card, target } = useEmitters();
  const { emitterNode } = useForces();
  const emitter = useEmitterModel();
  const host = useHostSkin();
  const surface = emitter?.emissionSurface ?? null;
  const mesh = useQuery(
    viewportQueries.mesh(surface?.kind === "mesh" ? (surface.mesh?.asset ?? null) : null),
  );
  const skeleton = useQuery(
    viewportQueries.skeleton(
      surface?.kind === "skeleton" ? (surface.skeleton?.asset ?? null) : null,
    ),
  );
  const bound = host.model !== undefined;

  return useMemo(() => {
    if (card === undefined || target === "system" || emitterNode == null) return NO_CHECKS;

    return emissionChecks(emitterNode, {
      simple: card.simple,
      emitter,
      bound,
      submeshes: mesh.data?.ranges.map((range) => range.name) ?? null,
      joints:
        skeleton.data?.joints.filter((joint) => joint.parent >= 0).map((joint) => joint.name) ??
        null,
    });
  }, [card, target, emitterNode, emitter, bound, mesh.data, skeleton.data]);
}

/**
 * The failed emission checks of one inspector group, one line each.
 *
 * "The emission source" in docs/ux/BIN_EDITOR.md.
 */
export function EmissionNotes({ group }: { group: CheckGroup }) {
  const notes = useEmissionChecks()
    .filter((check) => check.group === group)
    .map((check) => ({ id: check.id, tone: check.tone, text: checkText(check) }));

  return <NoteList notes={notes} name="EmissionNotes" />;
}

/** `value` as text, with at most three decimals and no trailing zeroes. */
function plain(value: number): string {
  return String(Number(value.toFixed(3)));
}

function checkText(check: EmissionCheck): string {
  switch (check.id) {
    case "noRate":
      return m.workshop_bin_emission_check_no_rate_hint();
    case "endsBeforeStart":
      return m.workshop_bin_emission_check_ends_before_start_hint({
        end: plain(check.end),
        start: plain(check.start),
      });
    case "neverActive":
      return m.workshop_bin_emission_check_never_active_hint();
    case "activeWithoutPeriod":
      return m.workshop_bin_emission_check_active_without_period_hint({
        active: plain(check.active),
      });
    case "burstWithPeriod":
      return m.workshop_bin_emission_check_burst_with_period_hint();
    case "rateReplaced":
      return m.workshop_bin_emission_check_rate_replaced_hint({
        slope: plain(check.slope),
        base: plain(check.base),
        most: plain(check.most),
      });
    case "simpleSource":
      return m.workshop_bin_emission_check_simple_source_hint();
    case "surfaceEmpty":
      return m.workshop_bin_emission_check_surface_empty_hint();
    case "meshFilesMissing":
      return m.workshop_bin_emission_check_mesh_files_missing_hint();
    case "skeletonFileMissing":
      return m.workshop_bin_emission_check_skeleton_file_missing_hint();
    case "submeshesUnmatched":
      return m.workshop_bin_emission_check_submeshes_unmatched_hint();
    case "jointsUnmatched":
      return m.workshop_bin_emission_check_joints_unmatched_hint();
    case "linkedMesh":
      return m.workshop_bin_emission_check_linked_mesh_hint();
    case "generator":
      return m.workshop_bin_emission_check_generator_hint();
    case "noUnit":
      return m.workshop_bin_emission_check_no_unit_hint();
    case "stillNormals":
      return m.workshop_bin_emission_check_still_normals_hint();
  }
}
