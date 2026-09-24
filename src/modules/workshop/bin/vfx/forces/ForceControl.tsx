import { ArrowsOutCardinalIcon } from "@phosphor-icons/react";
import { use, useRef, useState } from "react";

import {
  Button,
  IconButton,
  InputDefaultContext,
  Readout,
  Switch,
  Table,
  Tooltip,
} from "@/components";
import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { FieldCard, schemaDeclared } from "../../classes/components/FieldCard";
import { useClassSchema } from "../../classes/hooks/useClassSchema";
import { Sparkline } from "../../curves/components/Sparkline";
import { CurveDockContext } from "../../curves/state/curveTarget";
import { DeclaredRowState } from "../../documents/components/DeclaredLayer";
import { nameHash } from "../../shared/utils/binHash";
import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { curve as readCurve, field } from "../engine/parsing/readValue";
import { commitForceValue } from "./forceEdits";
import {
  type AuthoredForce,
  FORCE_DEFAULT_BUILD,
  type ForceProperty,
  type ForceValue,
  forceValue,
} from "./forceModel";
import { useForcePreview } from "./forcePreview";

const AXES = ["X", "Y", "Z"];
const TINTS = ["text-channel-1-text", "text-channel-2-text", "text-channel-3-text"];

/** A force property in aligned label and value cells, with its animation below. */
export function ForceControl({
  force,
  property,
  hosted,
  disabled,
}: {
  force: AuthoredForce;
  property: ForceProperty;
  hosted: boolean;
  disabled: boolean;
}) {
  const edit = use(LeafEditContext);
  const preview = useForcePreview();
  const dock = use(CurveDockContext);
  const classHash = nameHash(force.definition.className);
  const { data: schema } = useClassSchema(classHash);
  const held = forceValue(force, property);
  const refusal = edit?.refused.get(`${force.row.entry}:${held.leaf?.path ?? force.row.path}`);
  const known = held.authored || schema?.build === FORCE_DEFAULT_BUILD;
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const editable =
    edit !== null &&
    held.valid &&
    known &&
    !disabled &&
    !busy &&
    (held.leaf !== null || edit.editProperty !== undefined);
  const curve =
    property.animated &&
    field(field(force.node, nameHash(property.name)), nameHash("dynamics"))?.type === "struct";
  const keys = readCurve(field(force.node, nameHash(property.name)), {
    constant: [],
    keys: [],
    tables: [],
  }).keys;
  const handle =
    property.name === "Position" ||
    property.name === "radius" ||
    (property.shape === "vector" && property.name !== "axisFraction");

  async function commit(value: ForceValue) {
    if (!editable || edit === null || saving.current) {
      return;
    }

    saving.current = true;
    setBusy(true);

    try {
      setInvalid(!(await commitForceValue(edit, force, property, value)));
    } catch {
      setInvalid(true);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function number(text: string, index: number) {
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value) || typeof held.value === "boolean") {
      setInvalid(true);
      return;
    }

    const next = [...held.value];
    next[index] = value;
    void commit(next);
  }

  return (
    <InputDefaultContext value={!held.authored}>
      <Table.Row data-ui="ForcesSection:property" className="hover:bg-surface-veil-soft">
        <Table.Head
          scope="row"
          className={twMerge(
            "border-r border-b-0 border-surface-700/40 bg-transparent py-0 pr-2 pl-5 align-top text-row font-normal text-surface-200",
            !held.authored && "text-surface-400",
          )}
        >
          <FieldCard
            classHash={classHash}
            fieldHash={nameHash(property.name)}
            name={property.name}
            label={property.label()}
            unnamed={false}
            declared={schemaDeclared(schema, nameHash(property.name))}
            defaultValue={held.authored || !known ? null : JSON.stringify(held.value)}
            triggerClassName="block leading-6"
          />
        </Table.Head>
        <Table.Cell className="border-b-0 px-2 py-0">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-h-6 min-w-0 items-center gap-1">
              <div className="min-w-0 flex-1">
                {!known && (
                  <span className="text-meta text-surface-400">
                    {m.workshop_bin_force_default_unknown_hint()}
                  </span>
                )}
                {known && typeof held.value === "boolean" && (
                  <Switch
                    aria-label={property.label()}
                    checked={held.value}
                    disabled={!editable}
                    onCheckedChange={(value) => void commit(value)}
                  />
                )}
                {known && typeof held.value !== "boolean" && (
                  <div className="flex min-w-0 items-center gap-1">
                    {held.value.map((value, index) => (
                      <Readout
                        key={index}
                        value={String(value)}
                        label={property.shape === "vector" ? AXES[index] : undefined}
                        labelClassName={TINTS[index]}
                        aria-label={`${property.label()}${property.shape === "vector" ? ` ${AXES[index]}` : ""}`}
                        className={
                          property.shape === "vector"
                            ? "w-[var(--bin-component-width,6rem)]"
                            : "w-[var(--bin-scalar-width,8rem)]"
                        }
                        step={property.shape === "vector" ? 1 : 0.1}
                        invalid={invalid || !held.valid || refusal !== undefined}
                        onCommit={editable ? (text) => number(text, index) : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
              <span className="flex w-5 shrink-0 items-center">
                {hosted && handle && editable && !curve && (
                  <Tooltip content={m.workshop_bin_force_handle_action()}>
                    <IconButton
                      size="xs"
                      variant="ghost"
                      disabled={
                        preview.muted.has(force.key) ||
                        (preview.solo !== null && preview.solo !== force.key)
                      }
                      icon={<ArrowsOutCardinalIcon className="h-3.5 w-3.5" />}
                      aria-label={m.workshop_bin_force_handle_label({ property: property.label() })}
                      onClick={() => preview.select(force.key, property.name)}
                    />
                  </Tooltip>
                )}
              </span>
            </div>
            {curve && held.row !== null && (
              <div className="flex min-w-0 flex-col gap-1">
                {keys.length > 0 && (
                  <span className="text-meta text-surface-400">
                    {m.workshop_bin_force_animated_hint()}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => dock?.aim({ row: held.row!, chain: force.definition.title() })}
                >
                  {m.workshop_bin_force_curve_action()}
                  <Sparkline keys={keys} label={property.label()} wide />
                </Button>
              </div>
            )}
            {(invalid || refusal !== undefined) && (
              <p role="alert" className="text-meta text-danger-text">
                {m.workshop_bin_force_save_failed_hint()}
              </p>
            )}
            <DeclaredRowState
              rowKey={`${force.row.entry}:${held.leaf?.path ?? held.row?.path ?? force.row.path}`}
            />
          </div>
        </Table.Cell>
      </Table.Row>
    </InputDefaultContext>
  );
}
