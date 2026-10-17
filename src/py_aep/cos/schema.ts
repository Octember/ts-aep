/**
 * zod schemas for the text-document COS tree (the `btdk` blob).
 *
 * The schemas are the single source of the tree's TypeScript types: every
 * exported type below is `z.output` of its schema, and the text models and
 * resolvers read the tree through those types. Keys are the ones py_aep
 * reads or writes (cos/descriptors.py, models/text/*.py,
 * resolvers/text_*.py), with value kinds taken from the 644 upstream
 * samples.
 *
 * The schemas are permissive by construction and never transform: a
 * dictionary is checked only for the keys it actually has, unknown keys
 * are ignored, and parsing returns the input `Map` itself. py_aep never
 * validates COS (it fails late, at the point of use), so the library does
 * not run these schemas; `tests/cos/schema.test.ts` checks that every
 * sample's tree conforms, which is what makes the types true for real
 * files. The readers keep their runtime guards (`instanceof Map`,
 * `is_real`, ...) for files that do not conform.
 */

import * as z from "zod/mini";
import { KeyError, PyFloat, repr } from "../../pyrt/index.ts";
import { CosName, CosString, type CosKey, type CosMap, type CosNode } from "./cos.ts";

// -- Leaves -------------------------------------------------------------------

/** A COS integer literal (a JS number; Python `int`). */
export const cos_int = z.number().check(z.refine((n) => Number.isInteger(n)));
/** A COS real: a boxed `PyFloat` as parsed (`1.0`), or a plain number where py_aep writes an int. */
export const cos_real = z.union([z.number(), z.instanceof(PyFloat)]);
export const cos_bool = z.boolean();
/** A COS string: `CosString` as parsed, a plain `string` once py_aep writes it, bytes when undecodable. */
export const cos_text = z.union([z.string(), z.instanceof(CosString), z.instanceof(Uint8Array)]);
/** A COS name object (`/SimplePaint`), the class tag under key `"99"`. */
export const cos_name = z.instanceof(CosName);

export type CosInt = z.output<typeof cos_int>;
export type CosReal = z.output<typeof cos_real>;
export type CosText = z.output<typeof cos_text>;

// -- Dictionaries -------------------------------------------------------------

type Shape = { [key: string]: z.ZodMiniType<CosNode> };
type ShapeOutput<S extends Shape> = { -readonly [K in keyof S]: z.output<S[K]> } extends infer O ? { [K in keyof O]: O[K] } : never;

/**
 * A COS dictionary schema: a `Map` whose keys present in `shape` match
 * their schemas. Absent keys and keys outside `shape` always pass.
 */
export function cos_dict<const S extends Shape>(shape: S): z.ZodMiniType<CosMap<ShapeOutput<S>>> {
  return z.custom<CosMap<ShapeOutput<S>>>((value) => value instanceof Map).check(
    z.superRefine((map, ctx) => {
      for (const [key, schema] of Object.entries(shape)) {
        if (!map.has(key)) continue;
        const result = schema.safeParse(map.get(key));
        if (result.success) continue;
        for (const issue of result.error.issues) ctx.addIssue({ ...issue, path: [key, ...issue.path] });
      }
    }),
  );
}

/** A `{"99": /SimplePaint, "0": {"0": type, "1": [a, r, g, b]}}` fill or stroke paint. */
export const paint = cos_dict({
  "99": cos_name,
  "0": cos_dict({ "0": cos_int, "1": z.array(cos_real) }),
});

/** A character style (run payload, document default and preset style). */
export const char_style = cos_dict({
  "0": cos_int, // font index into the font table
  "1": cos_real, // font size
  "2": cos_bool, // faux bold
  "3": cos_bool, // faux italic
  "4": cos_bool, // auto leading
  "5": cos_real, // leading
  "6": cos_real, // horizontal scale
  "7": cos_real, // vertical scale
  "8": cos_int, // tracking
  "9": cos_real, // baseline shift
  "11": cos_int, // auto kern type
  "12": cos_int, // font caps option
  "13": cos_int, // font baseline option
  "18": cos_bool, // ligature
  "35": cos_int, // baseline direction
  "36": cos_real, // tsume
  "52": cos_bool, // no break
  "53": paint, // fill
  "54": paint, // stroke
  "56": cos_bool, // apply fill
  "57": cos_bool, // apply stroke
  "58": cos_bool, // stroke over fill
  "62": cos_int, // line join type
  "63": cos_real, // stroke width
  "70": cos_int, // digit set
});

/** A paragraph style (run payload). */
export const para_style = cos_dict({
  "0": cos_int, // justification
  "1": cos_real, // first line indent
  "2": cos_real, // start indent
  "3": cos_real, // end indent
  "4": cos_real, // space before
  "5": cos_real, // space after
  "7": cos_real, // auto leading factor
  "8": cos_int, // leading type
  "9": cos_bool, // auto hyphenate
  "21": cos_bool, // hanging roman
  "29": cos_bool, // every-line composer
  "33": cos_int, // paragraph direction
});

/** A manual-kerning run payload: `"0"` is the kern value (absent in gap runs). */
export const kern_payload = cos_dict({ "0": cos_int });

/** `{"0": payload, "1": UTF-16 count}` run entries. */
const run = <P extends z.ZodMiniType<CosNode>>(payload: P) => cos_dict({ "0": payload, "1": cos_int });
export const char_run = run(cos_dict({ "0": cos_dict({ "0": cos_text, "5": cos_int, "6": char_style }) }));
export const para_run = run(cos_dict({ "0": cos_dict({ "0": cos_text, "5": para_style, "6": cos_int }) }));
export const kern_run = run(kern_payload);
/** A per-paragraph composed-line count run (`doc["1"]["1"]["0"]`). */
export const line_count_run = run(cos_dict({ "1": cos_int }));

/**
 * Layout-cache tree node (`doc["1"]["2"]`), nested `/PC`, `/F`, `/R`,
 * `/R`, `/L` (line), `/S` (segment) and `/G` nodes, tagged by `"99"` and nested
 * through `"6"`. One node type for every tag, so the keys whose kind
 * depends on the tag are unions: `"6"` is the child array except on `/G`
 * (a dict), `"10"` is the `/L` baseline (a dict on `/G`), and `"15"` is
 * the `/S` segment record (a real on `/L`, an array on `/G`).
 */
export interface CacheNode
  extends CosMap<{
    "99": CosName;
    "6": CacheNode[] | CosMap;
    "0": CosMap<{ "0": CosReal[] }>;
    "10": CosReal | CosMap;
    "15": CosReal | CosReal[] | CosMap<{ "0": CosInt; "7": CosMap<{ "7": CosReal[] }> }>;
  }> {}
export const cache_node: z.ZodMiniType<CacheNode> = cos_dict({
  "99": cos_name,
  "6": z.union([z.lazy(() => z.array(cache_node)), cos_dict({})]),
  "0": cos_dict({ "0": z.array(cos_real) }), // /L pen origin
  "10": z.union([cos_real, cos_dict({})]),
  "15": z.union([cos_real, z.array(cos_real), cos_dict({ "0": cos_int, "7": cos_dict({ "7": z.array(cos_real) }) })]),
});

/** A document's text and style runs (`doc["0"]`). */
export const doc_text = cos_dict({
  "0": cos_text, // the raw text, CR line breaks plus a terminator CR
  "5": cos_dict({ "0": z.array(para_run) }),
  "6": cos_dict({ "0": z.array(char_run) }),
  "7": cos_int, // leading-edge manual kern value
  "8": cos_dict({ "0": z.array(kern_run) }),
});

/** A document's composition state (`doc["1"]`): line counts and the layout cache. */
export const doc_layout = cos_dict({
  "1": cos_dict({ "0": z.array(line_count_run) }),
  "2": z.array(cache_node),
});

/** One text document (`cos["1"]["1"][i]`, one per keyframe). */
export const doc_cos = cos_dict({ "0": doc_text, "1": doc_layout });

/** A font's CoolType record (`cos["0"]["1"]["0"][i]["0"]["0"]`). */
export const font_data = cos_dict({
  "0": cos_text, // PostScript name
  "4": z.array(cos_int), // design vector, 16.16 fixed point
  "5": cos_text, // version (name ID 5)
});
export const font_entry = cos_dict({ "99": cos_name, "0": font_data });

/** Box metadata (`frame["2"]`). */
export const frame_meta = cos_dict({
  "0": cos_int,
  "1": cos_int, // line orientation
  "6": z.array(cos_real),
  "9": cos_real, // inset spacing
  "10": cos_dict({ "0": cos_int, "1": cos_real }), // first-baseline alignment + minimum
  "11": cos_dict({ "4": cos_int, "18": cos_real }),
  "13": cos_int, // vertical alignment
  "14": cos_int, // auto-fit policy
});

/** The box frame (`cos["0"]["8"]["0"][0]["0"]`): outline and box metadata. */
export const frame = cos_dict({
  "1": cos_dict({ "0": z.array(cos_real) }), // 16-vertex box outline (box text only)
  "2": frame_meta,
});

/** A used-font record (`cos["1"]["5"][i]["4"][j]`): font index and version. */
export const used_font_record = cos_dict({ "0": cos_int, "1": cos_text });

/** A font table entry (`cos["0"]["1"]["0"][i]`). */
export const font_table_entry = cos_dict({ "0": font_entry });

/** Shared resources (`cos["0"]`): font table, style presets, box frames. */
export const btdk_resources = cos_dict({
  "1": cos_dict({ "0": z.array(font_table_entry) }),
  "5": cos_dict({ "0": z.array(cos_dict({ "0": cos_dict({ "0": cos_text, "6": char_style }) })) }),
  "8": cos_dict({ "0": z.array(cos_dict({ "0": frame })) }),
});

/** Document state (`cos["1"]`): typography, the documents, default style, engine, font usage. */
export const btdk_state = cos_dict({
  "0": cos_dict({ "0": cos_dict({ "0": cos_int }) }), // typography settings (font index)
  "1": z.array(doc_cos),
  "2": char_style, // document-default character style
  "4": cos_dict({ "3": cos_text }), // composer engine name
  "5": z.array(cos_dict({ "4": z.array(used_font_record) })), // font-usage sessions
});

/** The whole `btdk` tree. */
export const btdk_cos = cos_dict({ "0": btdk_resources, "1": btdk_state });

export type Paint = z.output<typeof paint>;
export type CharStyle = z.output<typeof char_style>;
export type ParaStyle = z.output<typeof para_style>;
export type KernPayload = z.output<typeof kern_payload>;
export type CharRun = z.output<typeof char_run>;
export type ParaRun = z.output<typeof para_run>;
export type KernRun = z.output<typeof kern_run>;
export type LineCountRun = z.output<typeof line_count_run>;
export type DocText = z.output<typeof doc_text>;
export type DocLayout = z.output<typeof doc_layout>;
export type DocCos = z.output<typeof doc_cos>;
export type FontData = z.output<typeof font_data>;
export type FontEntry = z.output<typeof font_entry>;
export type FontTableEntry = z.output<typeof font_table_entry>;
export type BtdkResources = z.output<typeof btdk_resources>;
export type BtdkState = z.output<typeof btdk_state>;
export type FrameMeta = z.output<typeof frame_meta>;
export type Frame = z.output<typeof frame>;
export type UsedFontRecord = z.output<typeof used_font_record>;
export type BtdkCos = z.output<typeof btdk_cos>;

// -- Typed Map access -----------------------------------------------------------
// pyrt's `dict_get` / `getitem` / `setdefault`, typed by the key's schema type.

/** `d.get(k, default)`. */
export function cos_value<S, K extends string, D = null>(d: CosMap<S>, k: K, dflt: D = null as D): CosKey<S, K> | D {
  return d.has(k) ? d.get(k)! : dflt;
}

/** `d[k]` (KeyError when absent). */
export function cos_item<S, K extends string>(d: CosMap<S>, k: K): CosKey<S, K> {
  if (!d.has(k)) throw new KeyError(repr(k));
  return d.get(k)!;
}

/** `d.setdefault(k, v)`. */
export function cos_setdefault<S, K extends string>(d: CosMap<S>, k: K, v: CosKey<S, K>): CosKey<S, K> {
  if (!d.has(k)) d.set(k, v);
  return d.get(k)!;
}

/**
 * `new Map(entries)` typed as the COS dictionary layout `M` (usually
 * inferred from where the result goes). The entries are not checked
 * against `M`; the conformance test covers what py_aep writes.
 */
export function cos_map<M extends CosMap<any>>(entries: readonly (readonly [string, CosNode])[] = []): M {
  return new Map(entries) as M;
}
