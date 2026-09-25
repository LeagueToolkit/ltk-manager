/**
 * GLSL run ahead of a translated vertex stage, which computes the engine's vertex inputs out
 * of the viewport's attributes.
 *
 * `source` is appended after the stage. It declares the attributes and uniforms it reads,
 * and `void enginePrelude()`, which writes each engine input to the `vec4` global named
 * for it: `a_TEXCOORD1` is written as `engine_TEXCOORD1`. The splice declares those globals.
 */
export interface VertexPrelude {
  readonly source: string;
  /** The engine inputs `enginePrelude()` writes, by the stage's attribute name. */
  readonly inputs: readonly string[];
  /**
   * The buffer members `enginePrelude()` writes per vertex in place of the bound value, by
   * the engine's name, and the registers each takes. Register `r` of `NAME` is written as
   * `engine_NAME[r]`, its first component the member's first float.
   */
  readonly members?: Readonly<Record<string, number>>;
}

/**
 * Where one buffer member sits in a stage: the array uniform its block inlines to, and the
 * bytes of it the prelude writes, which stay within the registers the prelude counts.
 */
export interface MemberSlot {
  readonly member: string;
  readonly array: string;
  readonly offset: number;
  readonly size: number;
}

/** The slots of the prelude's members in each stage that declares them. */
export interface StageSlots {
  readonly vertex: readonly MemberSlot[];
  readonly pixel: readonly MemberSlot[];
}

const NO_SLOTS: StageSlots = { vertex: [], pixel: [] };

/** What an input reads where no stream feeds it: white for a colour, zero for the rest. */
const ABSENT: Readonly<Record<string, string>> = { a_COLOR: "vec4(1.0, 1.0, 1.0, 1.0)" };
const ZERO = "vec4(0.0, 0.0, 0.0, 0.0)";

/** A translated input: `layout(location = N) in TYPE a_NAME;`, the layout being optional. */
const INPUT = /^(?:layout\(location = \d+\) )?in (\w+) (a_\w+);$/gm;

const MAIN = /\bvoid main\(\)/;
const RENAMED_MAIN = "hexshade_main";

const REGISTER_BYTES = 16;
const FLOAT_BYTES = 4;
const COMPONENTS = "xyzw";

/**
 * `glsl`, a translated vertex stage, run behind `prelude`.
 *
 * Each engine input becomes a global of its declared type, which the prelude writes and the
 * stage reads unchanged, and the stage's `main` is renamed and called last. An input the
 * prelude does not write reads what an absent stream reads. The stage's inputs stop being
 * attributes. The geometry feeds only the prelude's inputs.
 *
 * The stage reads a block `slots.vertex` reaches through a copy of it, which each member's
 * registers overwrite. A member in `slots.pixel` leaves through a flat output
 * `splicePixelProgram` reads.
 */
export function spliceVertexProgram(
  glsl: string,
  prelude: VertexPrelude,
  slots: StageSlots = NO_SLOTS,
): string {
  const declared = new Map<string, string>();
  const stage = glsl
    .replace(INPUT, (_, type: string, name: string) => {
      declared.set(name, type);
      return `${type} ${name} = ${type}(${ABSENT[name] ?? ZERO});`;
    })
    .replace(MAIN, `void ${RENAMED_MAIN}()`);
  const copies = withCopies(stage, slots.vertex, engineMember);
  const varyings = varyingRegisters(slots.pixel);

  const engine = [
    ...prelude.inputs.map((input) => `vec4 ${engineName(input)};`),
    ...Object.entries(prelude.members ?? {}).map(
      ([member, registers]) => `vec4 engine_${member}[${registers}];`,
    ),
    ...varyings.map(({ member, index }) => `flat out vec4 ${varyingName(member, index)};`),
  ].join("\n");
  const writes = [
    ...prelude.inputs.flatMap((input) => {
      const type = declared.get(input);
      return type === undefined ? [] : [`${input} = ${type}(${engineName(input)});`];
    }),
    ...copies.writes,
    ...varyings.map(
      ({ member, index }) => `${varyingName(member, index)} = ${engineMember(member, index)};`,
    ),
  ];

  return `${copies.source}
${engine}

${prelude.source}
void main()
{
    enginePrelude();
${indented(writes)}    ${RENAMED_MAIN}();
}
`;
}

/**
 * `glsl`, a translated pixel stage, reading each member in `slots` from the flat output
 * `spliceVertexProgram` hands it, over a copy of its block.
 */
export function splicePixelProgram(glsl: string, slots: readonly MemberSlot[]): string {
  if (slots.length === 0) return glsl;

  const copies = withCopies(glsl.replace(MAIN, `void ${RENAMED_MAIN}()`), slots, varyingName);
  const inputs = varyingRegisters(slots).map(
    ({ member, index }) => `flat in vec4 ${varyingName(member, index)};`,
  );

  return `${copies.source}
${inputs.join("\n")}

void main()
{
${indented(copies.writes)}    ${RENAMED_MAIN}();
}
`;
}

/**
 * `source` reading each block `slots` reaches through a copy of it, and the lines that fill
 * each copy: the bound block, then every register of its members, read from `value`.
 *
 * A register past the array's length is one the translation cut as unread.
 */
function withCopies(
  source: string,
  slots: readonly MemberSlot[],
  value: (member: string, register: number) => string,
): { readonly source: string; readonly writes: readonly string[] } {
  let copied = source;
  const writes: string[] = [];
  for (const array of new Set(slots.map((slot) => slot.array))) {
    const found = new RegExp(`^uniform (\\w+) ${array}\\[(\\d+)\\];$`, "m").exec(copied);
    if (found === null) continue;

    const [declaration, element = "vec4", extent = "0"] = found;
    const copy = `hexshade_${array}`;
    copied = copied
      .replace(new RegExp(`(?<!uniform \\w+ )\\b${array}\\[`, "g"), `${copy}[`)
      .replace(declaration, `${declaration}\n${element} ${copy}[${extent}];`);
    writes.push(`${copy} = ${array};`);

    for (const slot of slots.filter((each) => each.array === array)) {
      for (const register of registersOf(slot)) {
        if (register.register >= Number(extent)) continue;

        const read = asElement(element, value(slot.member, register.memberRegister));
        writes.push(
          register.target === COMPONENTS
            ? `${copy}[${register.register}] = ${read};`
            : `${copy}[${register.register}].${register.target} = ${read}.${register.source};`,
        );
      }
    }
  }
  return { source: copied, writes };
}

/** One register a slot covers, and the components of it the member fills. */
interface SlotRegister {
  /** The register in the block. */
  readonly register: number;
  /** The register counted from the member's first, which the prelude writes it as. */
  readonly memberRegister: number;
  /** The components written, and the prelude value's components they read. */
  readonly target: string;
  readonly source: string;
}

function registersOf(slot: MemberSlot): SlotRegister[] {
  const end = slot.offset + slot.size;
  const first = Math.floor(slot.offset / REGISTER_BYTES);
  const last = Math.floor((end - 1) / REGISTER_BYTES);
  return Array.from({ length: last - first + 1 }, (_, step) => {
    const at = first + step;
    const from = Math.max(slot.offset, at * REGISTER_BYTES);
    const to = Math.min(end, (at + 1) * REGISTER_BYTES);
    const component = (from % REGISTER_BYTES) / FLOAT_BYTES;
    const floats = (to - from) / FLOAT_BYTES;
    const into = (from - slot.offset) / FLOAT_BYTES;
    return {
      register: at,
      memberRegister: Math.floor(into / COMPONENTS.length),
      target: COMPONENTS.slice(component, component + floats),
      source: COMPONENTS.slice(into % COMPONENTS.length, (into % COMPONENTS.length) + floats),
    };
  });
}

/** Each member register the pixel stage reads from the vertex stage, once. */
function varyingRegisters(slots: readonly MemberSlot[]): { member: string; index: number }[] {
  const seen = new Map<string, { member: string; index: number }>();
  for (const slot of slots) {
    for (const { memberRegister } of registersOf(slot)) {
      seen.set(varyingName(slot.member, memberRegister), {
        member: slot.member,
        index: memberRegister,
      });
    }
  }
  return [...seen.values()];
}

function asElement(element: string, value: string): string {
  if (element === "uvec4") return `floatBitsToUint(${value})`;
  if (element === "ivec4") return `floatBitsToInt(${value})`;
  return value;
}

function indented(lines: readonly string[]): string {
  return lines.map((line) => `    ${line}\n`).join("");
}

function engineName(input: string): string {
  return `engine_${input.replace(/^a_/, "")}`;
}

function engineMember(member: string, register: number): string {
  return `engine_${member}[${register}]`;
}

function varyingName(member: string, register: number): string {
  return `hexshade_${member}_${register}`;
}
