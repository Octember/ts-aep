/**
 * zod schemas for the text-document COS tree (the `btdk` blob).
 *
 * Two layers, both run by the library:
 *
 * - {@link decode_btdk} is the single entry point from untyped data: it
 *   checks the whole parsed blob against {@link cos_node} (every value a
 *   COS kind, every dictionary string-keyed) and only then hands the tree
 *   to the text models as a {@link CosDict}. Nothing deeper is checked
 *   there, because py_aep never validates COS: a value of the wrong kind
 *   fails (or is tolerated) at the point of use, so the decode must not
 *   reject what Python would read later or never.
 * - The layouts below name the kind of every key py_aep reads with an
 *   `isinstance` check; {@link read} runs the key's schema on the value
 *   at the moment it is read and returns it typed, or `undefined` when it
 *   is absent or of another kind (which is what the `isinstance` check
 *   decides in Python). Keys read through a Python builtin instead go
 *   through the operations in `kinds.ts`, which raise what the builtin
 *   raises.
 *
 * Keys and kinds are the ones py_aep reads or writes (cos/descriptors.py,
 * models/text/*.py, resolvers/text_*.py); `tests/unit/test_cos_schema.test.ts`
 * checks that every sample's tree takes the typed path at each of them.
 */

import * as z from "zod/mini";
import { PyFloat } from "../../pyrt/index.ts";
import { CosName, CosString, IndirectObject, IndirectReference, Stream, type CosDict, type CosNode } from "./cos.ts";
import { py_int, py_number, py_str } from "./kinds.ts";

/** Any COS value, checked recursively (dictionaries and arrays included). */
export const cos_node: z.ZodMiniType<CosNode> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.instanceof(PyFloat),
    z.string(),
    z.instanceof(CosString),
    z.instanceof(Uint8Array),
    z.instanceof(CosName),
    z.instanceof(IndirectObject),
    z.instanceof(IndirectReference),
    z.instanceof(Stream),
    z.array(cos_node),
    z.map(z.string(), cos_node),
  ]),
);

/** Whether `tree` is a COS dictionary whose every value is a COS value (see {@link cos_node}). */
function is_cos_dict(tree: unknown): tree is CosDict {
  return tree instanceof Map && cos_node.safeParse(tree).success;
}

/**
 * Decode a parsed `btdk` blob: the tree itself when it is a COS
 * dictionary of COS values, else `null` (py_aep then gives the layer no
 * text documents, as for any non-dict blob).
 */
export function decode_btdk(tree: unknown): CosDict | null {
  return is_cos_dict(tree) ? tree : null;
}

// -- Layouts --------------------------------------------------------------------

/** The kind of each key of one COS dictionary layout. */
export type Layout = { readonly [key: string]: z.ZodMiniType<CosNode> };

/**
 * `d[key]` typed by the layout: the value when present and of the
 * layout's kind for `key` (the schema runs on the current value), else
 * `undefined`.
 */
export function read<L extends Layout, K extends keyof L & string>(layout: L, d: CosDict, key: K): z.output<L[K]> | undefined {
  if (!d.has(key)) return undefined;
  const result = layout[key].safeParse(d.get(key));
  return result.success ? result.data : undefined;
}

/** A COS name (`/SimplePaint`), the class tag under key `"99"`. */
export const cos_name = z.instanceof(CosName);

/** A character style (run payload, document default and preset style). */
export const char_style = {
  "0": py_int, // font index into the font table
  "1": py_number, // font size
  "2": z.boolean(), // faux bold
  "3": z.boolean(), // faux italic
  "4": z.boolean(), // auto leading
  "5": py_number, // leading
  "6": py_number, // horizontal scale
  "7": py_number, // vertical scale
  "8": py_int, // tracking
  "9": py_number, // baseline shift
  "11": py_int, // auto kern type
  "12": py_int, // font caps option
  "13": py_int, // font baseline option
  "18": z.boolean(), // ligature
  "35": py_int, // baseline direction
  "36": py_number, // tsume
  "52": z.boolean(), // no break
  "56": z.boolean(), // apply fill
  "57": z.boolean(), // apply stroke
  "58": z.boolean(), // stroke over fill
  "62": py_int, // line join type
  "63": py_number, // stroke width
  "70": py_int, // digit set
} as const;

/** A paragraph style (run payload). */
export const para_style = {
  "0": py_int, // justification
  "1": py_number, // first line indent
  "2": py_number, // start indent
  "3": py_number, // end indent
  "4": py_number, // space before
  "5": py_number, // space after
  "7": py_number, // auto leading factor
  "8": py_int, // leading type
  "9": z.boolean(), // auto hyphenate
  "21": z.boolean(), // hanging roman
  "29": z.boolean(), // every-line composer
  "33": py_int, // paragraph direction
} as const;

/** A `{"0": payload, "1": count}` style, kern or line-count run entry. */
export const run = { "1": py_int } as const;

/** A manual-kerning run payload: `"0"` is the kern value (absent in gap runs). */
export const kern_payload = { "0": py_int } as const;

/** A document's text dict (`doc["0"]`): text, runs, leading-edge kern value. */
export const doc_text = {
  "0": py_str, // the raw text, CR line breaks plus a terminator CR
  "7": py_int, // leading-edge manual kern value
} as const;

/** A layout-cache node (`doc["1"]["2"]`, nested through `"6"`), tagged `/PC`, `/F`, `/R`, `/L`, `/S` or `/G`. */
export const cache_node = {
  "99": cos_name, // tag
} as const;

/** A `/L` (line) cache node: its baseline (`"10"` is a dict on other tags). */
export const cache_line = {
  "99": cos_name,
  "10": py_number, // baseline
} as const;

/** A `/S` segment's record (`seg["15"]`): its UTF-16 count. */
export const cache_segment = { "0": py_int } as const;

/** Box metadata (`frame["2"]`). */
export const frame_meta = {
  "0": py_int,
  "1": py_int, // line orientation
  "9": py_number, // inset spacing
  "13": py_int, // vertical alignment
  "14": py_int, // auto-fit policy
} as const;

/** First-baseline settings (`frame["2"]["10"]`): alignment and minimum. */
export const first_baseline = { "0": py_int, "1": py_number } as const;

/** A font-index holder: a style, typography settings or used-font record (`"0"`). */
export const font_ref = { "0": py_int } as const;

/** A font's CoolType record (`cos["0"]["1"]["0"][i]["0"]["0"]`). */
export const font_data = {
  "0": py_str, // PostScript name
  "5": py_str, // version (name ID 5)
} as const;
