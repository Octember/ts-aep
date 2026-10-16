// `from __future__ import annotations` and the `typing` imports are dropped:
// annotations are TypeScript types only.
import {
  KeyError,
  NotImplementedError,
  RuntimeError,
  TypeError_,
  ValueError,
  b,
  bytes_,
  concat,
  decode,
  descriptor,
  dict_get,
  encode,
  int,
  isdigit,
  py_bool,
  py_or,
  repr,
  round,
  str,
} from "../../../../pyrt/index.ts";
import { CLAMP_DEPENDENTS } from "../../../data/output_module_rules.ts";
import {
  AudioCodec,
  AudioInterleave,
  DnxResolution,
  MPEGAudioFormat,
  MPEGAudioLayer,
  MPEGMultiplexer,
  MPEGMuxStreamCompatibility,
  MPEGProfile,
  VideoCodec,
} from "../../../enums/index.ts";
import { ChunkField } from "../../descriptors.ts";
import { _validate_number, validate_enum, validate_int } from "../../validators.ts";
import { FormatOptionsBase } from "./base.ts";
import type { RoptChunk } from "../../../binary/render_chunks.ts";
import type { OutputModule } from "../output_module.ts";

/** Adobe stores FPS as ticks-per-frame with a 254016000000 tick base. */
const _ADOBE_TICKS_PER_SECOND = 254016000000;

// -- Ropt body layout -------------------------------------------------------
// The body is a 34-byte header followed by the XML region. Two big-endian
// u32s in the header restate the sizes, and AE HONOURS them: it reads exactly
// `_LEN_BODY_OFFSET` bytes, so a stale value silently truncates the XML.
// Verified on all 129 AE-authored XML modules in the corpus - '.AVI' 15/15,
// 'H264' 31/31, 'MooV' 53/53, 'Mp3 ' 23/23, 'wao_' 7/7 - every one with a
// 34-byte header.
/** Offset of the u32 holding `len(body)`. */
const _LEN_BODY_OFFSET = 6;
/** Offset of the u32 holding `len(xml region) - 2` (i.e. excluding the NULs). */
const _LEN_XML_OFFSET = 30;

const _XML_DECLARATION = b('<?xml version="1.0" encoding="UTF-8"?>\n');
const _XML_NULS = b("\x00\x00");
/** Every AE-authored body ends `>\n\x00\x00`. */
const _XML_TERMINATOR = concat(b("\n"), _XML_NULS);

/**
 * An empty element with NO attributes; AE expands these (`<ParamName></ParamName>`)
 * while self-closing the ones that have attributes (`<Foo ObjectRef="1"/>`).
 */
const _EMPTY_ELEMENT_RE = /<([A-Za-z_][\p{L}\p{N}_.-]*)\/>/gu;

// XML param -> rules key: params whose writes are gated by the module's
// format rules (and whose changes re-clamp dependents, see
// CLAMP_DEPENDENTS). Params not listed here (frame rate, VR fields, ...)
// validate locally only.
const _PARAM_RULE_KEYS = new Map<string, string>([
  ["ADBEAudioBitrate", "Audio Bitrate"],
  ["ADBEAudioCodec", "Audio Codec"],
  ["ADBEMPEGAudioFormat", "Audio Format"],
  ["ADBEMPEGMultiplexer", "Multiplexer"],
  ["ADBEVideoCodec", "Video Codec"],
  ["BitRate", "BitRate"],
]);

// TODO(pyrt): `xml.etree.ElementTree` has no pyrt shim yet. This is the subset
// the module uses (fromstring, Element with text/tail/attrib/children, iter,
// find, insert, remove, SubElement, tostring(encoding="unicode")), with ET's
// own rules: text and tail model, attribute insertion order, `<a />` spacing
// for empty elements and ET's escaping. Move it to pyrt/xml_etree.ts when a
// second module needs it.
class ETElement {
  tag: string;
  attrib = new Map<string, string>();
  text: string | null = null;
  tail: string | null = null;
  children: ETElement[] = [];

  constructor(tag: string) {
    this.tag = tag;
  }

  /** `Element.iter(tag)`: every descendant-or-self with that tag, in document order. */
  iter(tag: string): ETElement[] {
    const out: ETElement[] = [];
    const visit = (elem: ETElement): void => {
      if (elem.tag === tag) out.push(elem);
      for (const child of elem.children) visit(child);
    };
    visit(this);
    return out;
  }

  /** `Element.find(tag)`: first direct child with that tag, or `None`. */
  find(tag: string): ETElement | null {
    return this.children.find((child) => child.tag === tag) ?? null;
  }

  /** `Element.insert(index, elem)` */
  insert(index: number, elem: ETElement): void {
    this.children.splice(index, 0, elem);
  }

  /** `Element.remove(elem)`: matched by identity, as ET does. */
  remove(elem: ETElement): void {
    const i = this.children.indexOf(elem);
    if (i < 0) throw new ValueError("list.remove(x): x not in list");
    this.children.splice(i, 1);
  }
}

const _XML_TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s\/>!?]+)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const _XML_ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const _XML_ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g;
const _XML_NAMED_ENTITY: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** XML line-end normalisation: expat turns CR and CRLF into LF. */
function _xml_newlines(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

/** Character and entity references, as expat resolves them. */
function _xml_unescape(s: string): string {
  return s.replace(_XML_ENTITY, (_m: string, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return _XML_NAMED_ENTITY[e];
  });
}

/**
 * `ET.fromstring`. Comments, processing instructions and the DOCTYPE are
 * dropped, as ET's default TreeBuilder does. Malformed input raises
 * `ValueError` where ET raises `ParseError`.
 */
// TODO(pyrt): ET.ParseError (a SyntaxError subclass) is not modelled; malformed
// input raises ValueError with a different message.
function _xml_fromstring(text: string): ETElement {
  const stack: ETElement[] = [];
  let root: ETElement | null = null;
  let last = 0;
  const add_text = (s: string): void => {
    if (stack.length === 0 || s === "") return;
    const parent = stack[stack.length - 1];
    if (parent.children.length === 0) {
      parent.text = (parent.text ?? "") + s;
    } else {
      const prev = parent.children[parent.children.length - 1];
      prev.tail = (prev.tail ?? "") + s;
    }
  };
  for (const m of text.matchAll(_XML_TOKEN)) {
    const at = m.index!;
    add_text(_xml_unescape(_xml_newlines(text.slice(last, at))));
    last = at + m[0].length;
    if (m[1] !== undefined) {
      add_text(_xml_newlines(m[1]));
      continue;
    }
    if (m[2] !== undefined) {
      const top = stack.pop();
      if (top == null || top.tag !== m[2]) throw new ValueError(`mismatched tag: ${m[2]}`);
      continue;
    }
    if (m[3] !== undefined) {
      const elem = new ETElement(m[3]);
      for (const a of (m[4] ?? "").matchAll(_XML_ATTR)) {
        const raw = _xml_newlines(a[2] ?? a[3]).replace(/[\t\n]/g, " ");
        elem.attrib.set(a[1], _xml_unescape(raw));
      }
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(elem);
      } else if (root == null) {
        root = elem;
      } else {
        throw new ValueError("junk after document element");
      }
      if (m[5] !== "/") stack.push(elem);
    }
  }
  add_text(_xml_unescape(_xml_newlines(text.slice(last))));
  if (stack.length > 0) throw new ValueError("unclosed tag");
  if (root == null) throw new ValueError("no element found");
  return root;
}

function _xml_escape_cdata(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function _xml_escape_attrib(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\t", "&#09;");
}

/** ET's `_serialize_xml` with `short_empty_elements=True`. */
function _xml_serialize(elem: ETElement, out: string[]): void {
  out.push("<" + elem.tag);
  for (const [k, v] of elem.attrib) out.push(" " + k + '="' + _xml_escape_attrib(v) + '"');
  if (py_bool(elem.text) || elem.children.length > 0) {
    out.push(">");
    if (py_bool(elem.text)) out.push(_xml_escape_cdata(elem.text));
    for (const child of elem.children) _xml_serialize(child, out);
    out.push("</" + elem.tag + ">");
  } else {
    out.push(" />");
  }
  if (py_bool(elem.tail)) out.push(_xml_escape_cdata(elem.tail));
}

const ET = {
  Element: ETElement,
  fromstring: _xml_fromstring,
  /** `ET.SubElement(parent, tag)` */
  SubElement(parent: ETElement, tag: string): ETElement {
    const elem = new ETElement(tag);
    parent.children.push(elem);
    return elem;
  },
  /** `ET.tostring(element, encoding="unicode")` */
  tostring(element: ETElement, encoding = "us-ascii"): string {
    if (encoding !== "unicode") {
      throw new NotImplementedError("ET.tostring: only encoding='unicode' is ported");
    }
    const out: string[] = [];
    _xml_serialize(element, out);
    return out.join("");
  },
};

/** `type(value).__name__` for the TypeError message. */
// TODO(pyrt): no pyrt `type()` shim; this covers the value kinds this module sees.
function _py_type_name(value: any): string {
  if (value == null) return "NoneType";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "string") return "str";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (value instanceof Uint8Array) return "bytes";
  if (Array.isArray(value)) return "list";
  if (value instanceof Map) return "dict";
  return value.constructor?.name ?? "object";
}

/** `dict(*args).items()` for `ParamsDict.update`. */
// TODO(pyrt): no pyrt `dict()` constructor shim; covers a mapping, a list of pairs or a plain record.
function _dict_items(args: any[]): Iterable<[string, string]> {
  if (args.length === 0) return [];
  const src = args[0];
  if (src instanceof Map) return src.entries();
  if (Array.isArray(src)) return src;
  return Object.entries(src);
}

/** Descriptor for XML enum parameters (read/write). */
class _EnumParam {
  declare _key: string;
  declare _enum_cls: any;
  declare _name: string;

  constructor(key: string, enum_cls: any) {
    this._key = key;
    this._enum_cls = enum_cls;
  }

  __set_name__(owner: Function, name: string): void {
    this._name = name;
  }

  __get__(obj: XmlFormatOptions | null, objtype?: Function | null): any {
    if (obj == null) return this;
    return obj._enum_param(this._key, this._enum_cls);
  }

  __set__(obj: XmlFormatOptions, value: any): void {
    obj._set_enum_param(this._key, value, this._enum_cls);
  }
}

/**
 * Descriptor for plain integer XML parameters (read/write).
 *
 * Reads return `None` when the parameter is absent and fall back to
 * the raw string when it is non-numeric (the binary is trusted, like
 * `_try_enum_or_int` for enums). Writes require an `int`.
 */
class _ScalarParam {
  declare _key: string;
  declare _name: string;

  constructor(key: string) {
    this._key = key;
  }

  __set_name__(owner: Function, name: string): void {
    this._name = name;
  }

  __get__(obj: XmlFormatOptions | null, objtype?: Function | null): any {
    if (obj == null) return this;
    const raw = dict_get(obj.params, this._key, "");
    if (!py_bool(raw)) return null;
    try {
      return int(raw);
    } catch (e) {
      if (!(e instanceof ValueError)) throw e;
      return raw;
    }
  }

  __set__(obj: XmlFormatOptions, value: any): void {
    if (value == null) return;
    validate_int(value);
    obj._check_param_rule(this._key, value);
    obj._set_param(this._key, str(value));
    obj._clamp_after_param(this._key);
  }
}

/**
 * Extract parameter key-value pairs from a PremiereData XML tree.
 *
 * Parses `ExporterParam` elements regardless of child-tag order and
 * returns a mapping of identifier to value, plus a mapping of identifier
 * to `ParamValue` element for O(1) writes, plus a mapping of identifier
 * to the owning `ExporterParam` element.
 *
 * An `ExporterParam` with no `ParamValue` child is an UNSET parameter -
 * AE's encoding for e.g. the H.264 `Baseline` profile. It is left out of
 * the params dict (so it reads as absent) but kept in the element map, so
 * a later write can restore its value in place instead of appending a
 * duplicate element.
 *
 * Args:
 *     root: The parsed XML root element.
 *
 * Returns:
 *     Tuple of (params dict, value-elements dict, param-elements dict).
 */
function _extract_params(
  root: ETElement,
): [Map<string, string>, Map<string, ETElement>, Map<string, ETElement>] {
  const params = new Map<string, string>();
  const value_elements = new Map<string, ETElement>();
  const param_elements = new Map<string, ETElement>();
  for (const elem of root.iter("ExporterParam")) {
    const id_elem = elem.find("ParamIdentifier");
    if (id_elem == null || id_elem.text == null) continue;
    const identifier = id_elem.text;
    if (isdigit(identifier)) continue;
    param_elements.set(identifier, elem);
    const val_elem = elem.find("ParamValue");
    if (val_elem == null) continue;
    params.set(identifier, py_or(val_elem.text, ""));
    value_elements.set(identifier, val_elem);
  }
  return [params, value_elements, param_elements];
}

/** Try to parse an int, then map to an enum; fall back to int. */
function _try_enum_or_int(enum_cls: any, raw_str: string): any {
  let raw_value: number;
  try {
    raw_value = int(raw_str);
  } catch (e) {
    if (!(e instanceof ValueError)) throw e;
    return null;
  }
  try {
    return enum_cls.of(raw_value);
  } catch (e) {
    if (!(e instanceof ValueError)) throw e;
    return raw_value;
  }
}

/**
 * Dict subclass that syncs mutations back to the XML tree.
 *
 * `dict.update` / `setdefault` / `pop` / `clear` / `popitem` / `|=` are
 * C-level and do NOT call `__setitem__` / `__delitem__`, so every one of
 * them is overridden to route through them - otherwise they would mutate
 * the dict (and so the typed accessors' reads) while leaving the XML, and
 * therefore the saved file, unchanged.
 */
export class ParamsDict extends Map<string, string> {
  /**
   * A class default, not a bare annotation: `update` and friends below
   * reach `self._owner` through `__setitem__`, so a `ParamsDict` built
   * before `_owner` is assigned would raise AttributeError.
   */
  _owner: XmlFormatOptions | null = null;

  /** Python `__setitem__` */
  set(key: string, value: string): this {
    super.set(key, value);
    if (this._owner != null) this._owner._on_param_changed(key, value);
    return this;
  }

  /** Python `__delitem__` */
  delete(key: string): boolean {
    if (!super.has(key)) throw new KeyError(repr(key));
    super.delete(key);
    if (this._owner != null) this._owner._on_param_removed(key);
    return true;
  }

  // TODO(port): `**kwargs` of `update` is not translated; no call site passes keyword arguments.
  update(...args: any[]): void {
    for (const [key, value] of _dict_items(args)) {
      this.set(key, value);
    }
  }

  setdefault(key: string, default_: string = ""): string {
    if (!this.has(key)) this.set(key, default_);
    return this.get(key) as string;
  }

  pop(key: string, ...default_: string[]): string {
    if (!this.has(key)) {
      if (default_.length > 0) return default_[0];
      throw new KeyError(repr(key));
    }
    const value = this.get(key) as string;
    this.delete(key);
    return value;
  }

  popitem(): [string, string] {
    const keys = [...this.keys()];
    if (keys.length === 0) throw new KeyError(repr("popitem(): dictionary is empty"));
    const key = keys[keys.length - 1];
    const value = this.get(key) as string;
    super.delete(key);
    if (this._owner != null) this._owner._on_param_removed(key);
    return [key, value];
  }

  clear(): void {
    for (const key of [...this.keys()]) {
      this.delete(key);
    }
  }

  // `|` (__or__) needs no override: it returns a new plain dict rather
  // than mutating, so it cannot desync the XML. Only `|=` does.
  /** Python `__ior__` (`|=`) */
  __ior__(other: any): ParamsDict {
    this.update(other);
    return this;
  }
}

// Module-level descriptor declarations for the class body below; the
// `declare` lines inside the class keep the Python attribute order.
/**
 * XML-based format-specific render options.
 *
 * Shared by output formats that store their settings as a binary header
 * followed by a `PremiereData` XML block containing `ExporterParam`
 * elements. Applicable formats include AVI (`.AVI`), H.264 (`H264`),
 * MP3 (`Mp3 `), QuickTime (`MooV`), and WAV (`wao_`).
 *
 * Individual parameters are stored in the `params` dictionary, keyed by
 * their Adobe parameter identifier (e.g. `"ADBEVideoCodec"`).
 *
 * Example:
 *     ```python
 *     from py_aep import XmlFormatOptions, parse
 *
 *     app = parse("project.aep")
 *     om = app.project.render_queue.items[0].output_modules[0]
 *     if isinstance(om.format_options, XmlFormatOptions):
 *         print(om.format_options.video_codec)
 *     ```
 */
export class XmlFormatOptions extends FormatOptionsBase {
  /**
   * All `ExporterParam` key-value pairs extracted from the embedded XML
   * `PremiereData` block. Keys are Adobe parameter identifiers such as
   * `"ADBEVideoCodec"`, `"ADBEVideoQuality"`,
   * `"ADBEAudioInterleave"`, etc. Values are the raw string
   * representations from the XML. Read / Write.
   *
   * Writes through this dict are the documented low-level escape hatch:
   * they bypass the typed accessors' format-rule validation and clamps.
   * Item assignment (`params[key] = value`), `update` and `setdefault`
   * all sync back to the XML. Removal (`pop`/`del`) only mutates the
   * dict: the `ExporterParam` element stays in the file.
   */
  declare params: ParamsDict;
  declare _body: RoptChunk;
  declare _xml_root: ETElement | null;
  declare _xml_header: Uint8Array | null;
  declare _val_elements: Map<string, ETElement>;
  declare _param_elements: Map<string, ETElement>;

  constructor(kw: { _body: RoptChunk }) {
    super();
    const { _body } = kw;
    this._body = _body;

    const raw = _body.data;
    this._xml_root = null;
    this._xml_header = null;
    this._val_elements = new Map();
    this._param_elements = new Map();
    this.params = new ParamsDict();
    this.params._owner = null;
    const xml_start = bytes_.find(raw, b("<?xml"));
    if (xml_start >= 0) {
      this._xml_header = raw.slice(0, xml_start);
      const xml_text = decode(raw.slice(xml_start), "utf-8", "replace").split("\x00")[0];
      this._xml_root = ET.fromstring(xml_text);
      const [data, val_elements, param_elements] = _extract_params(this._xml_root);
      this._val_elements = val_elements;
      this._param_elements = param_elements;
      this.params.update(data);
    }
    this.params._owner = this;
  }

  /**
   * The 4-character format identifier from the Ropt chunk header
   * (e.g. `".AVI"`, `"H264"`, `"Mp3 "`, `"MooV"`, `"wao_"`).
   * Read-only.
   */
  declare format_code: string;

  // -- write helpers -----------------------------------------------------

  /** Update a parameter in the XML tree and sync to the raw body. */
  _set_param(key: string, str_value: string): void {
    this.params.set(key, str_value);
  }

  /** Sync a param change to the XML tree and raw body. */
  _on_param_changed(key: string, str_value: string): void {
    // Every `params` mutation funnels through here by design, so this is
    // where a detached wrapper's raw-dict writes are caught - `params`
    // is a `__setitem__` surface, which `__setattr__` cannot see.
    this._check_attached();
    if (this._xml_root == null) return;
    const val_elem = dict_get(this._val_elements, key);
    if (val_elem != null) {
      val_elem.text = str_value;
      this._sync_xml();
      return;
    }
    const param_elem = dict_get(this._param_elements, key);
    if (param_elem != null) {
      // An existing but UNSET param: restore its value in place rather
      // than appending a duplicate element. AE writes `ParamValue` as
      // the element's first child; its tail carries the indentation
      // that used to precede the (currently first) next sibling, which
      // is what the element's own `text` holds.
      const val = new ET.Element("ParamValue");
      val.text = str_value;
      val.tail = param_elem.text;
      param_elem.insert(0, val);
      this._val_elements.set(key, val);
    } else {
      const ep = ET.SubElement(this._xml_root, "ExporterParam");
      ET.SubElement(ep, "ParamIdentifier").text = key;
      const val = ET.SubElement(ep, "ParamValue");
      val.text = str_value;
      this._val_elements.set(key, val);
      this._param_elements.set(key, ep);
    }
    this._sync_xml();
  }

  /**
   * Unset a parameter by dropping only its `ParamValue` child.
   *
   * AE encodes an unset parameter (e.g. the H.264 `Baseline` profile)
   * by removing the `ParamValue` and KEEPING the `ExporterParam`
   * element - its `ObjectID` is referenced by the PremiereData object
   * graph. Both encodings decode identically (the param reads as absent
   * either way), so only a raw-XML comparison against an AE-saved
   * `Baseline` module distinguishes them.
   */
  _on_param_removed(key: string): void {
    this._check_attached();
    if (this._xml_root == null) return;
    this._val_elements.delete(key);
    const param_elem = dict_get(this._param_elements, key);
    if (param_elem == null) return;
    const val = param_elem.find("ParamValue");
    if (val != null) param_elem.remove(val);
    this._sync_xml();
  }

  /** Set an Adobe parameter from an enum or int value. */
  _set_enum_param(key: string, value: any, enum_cls: any = null): void {
    if (value == null) return;
    // TODO(port): int/float distinction. Python `isinstance(2.0, int)` is False,
    // but JS cannot tell `2.0` from `2`.
    if (!((typeof value === "number" && Number.isInteger(value)) || typeof value === "boolean")) {
      throw new TypeError_(`expected an int or IntEnum for ${repr(key)}, got ${_py_type_name(value)}`);
    }
    // int() normalizes IntEnum members so str() yields the numeric form.
    const int_value = int(value);
    if (enum_cls != null && !enum_cls.has(int_value)) {
      const members = enum_cls
        .members()
        .map((m: any) => `${enum_cls.name_of(m)} (${m})`)
        .join(", ");
      throw new ValueError(
        `Invalid value ${repr(value)} for ${repr(key)}. ` +
          `Valid ${enum_cls.__name__} values: ${members}`,
      );
    }
    const checked = enum_cls != null ? enum_cls.of(int_value) : int_value;
    this._check_param_rule(key, checked);
    this._set_param(key, str(int_value));
    // NOTE: Rouu.video_codec is NOT synced here - it holds a constant
    // per-output-plugin handler tag ('DOVT' for QuickTime, 'CTXF' for
    // AVI/H.264), not the codec 4cc; every corpus sample confirms it
    // never varies with the selected codec.
    this._clamp_after_param(key);
  }

  /**
   * The owning output module. A format options object always belongs
   * to one; a missing back-reference is a wiring bug, not a permissive
   * case. (Detachment is a separate condition, caught by
   * `_check_attached` on every write path.)
   */
  _require_om(): OutputModule {
    const om = this._parent_om;
    if (om == null) {
      // Explicit raise (not assert) so the wiring bug stays loud
      // under `python -O` too.
      throw new RuntimeError("format options have no owning output module");
    }
    return om;
  }

  /**
   * Gate a rules-covered param write on the module's format rules.
   *
   * Params outside `_PARAM_RULE_KEYS` are not format-gated.
   */
  _check_param_rule(param_key: string, value: any): void {
    const rule_key = dict_get(_PARAM_RULE_KEYS, param_key, null);
    if (rule_key == null) return;
    this._require_om()._check_format_rule(rule_key, value);
  }

  /** Re-resolve dependent settings after a context param write. */
  _clamp_after_param(param_key: string): void {
    const rule_key = dict_get(_PARAM_RULE_KEYS, param_key, null);
    if (rule_key == null) return;
    this._require_om()._apply_singleton_clamps(dict_get(CLAMP_DEPENDENTS, rule_key, []));
  }

  /**
   * Re-serialize the XML tree back to the raw body, as AE writes it.
   *
   * The `Ropt` header embeds the body's own lengths and **After Effects
   * honours them**: it reads exactly `_LEN_BODY_OFFSET` bytes and
   * discards the rest. Leaving them stale made AE silently truncate the
   * XML mid-element on open and re-save the corruption (probed on AE
   * 26.3: an 87-byte-longer body was cut back to the stale length, losing
   * `</PremiereData>`). So the lengths MUST be repatched here.
   *
   * The rest matches AE's serializer byte-for-byte so that a no-op sync
   * is the identity - see `tests/roundtrip/test_xml_sync_fidelity.py`.
   *
   * Note:
   *     Byte-identity needs Python 3.8+: 3.7's `ET.tostring` sorts each
   *     element's attributes alphabetically instead of keeping document
   *     order, so a 3.7 write reorders them. The result is the same
   *     length and semantically identical XML that AE reads correctly -
   *     only the bytes differ from AE's. Parsing and saving without a
   *     write never calls this, so round-trip idempotency is unaffected.
   */
  _sync_xml(): void {
    if (this._xml_root == null || this._xml_header == null) return;
    const text0 = ET.tostring(this._xml_root, "unicode");
    // `ET` writes `<Foo a="1" />`; AE writes `<Foo a="1"/>`.
    const text1 = text0.replaceAll(" />", "/>");
    // `ET` self-closes every empty element; AE only does so when the
    // element has attributes, and expands the attribute-less ones.
    const text = text1.replace(_EMPTY_ELEMENT_RE, "<$1></$1>");
    const xml_bytes = concat(_XML_DECLARATION, encode(text, "utf-8"), _XML_TERMINATOR);
    const body = new Uint8Array(concat(this._xml_header, xml_bytes));
    // Back-patch the two self-describing lengths AE honours (a stale one
    // silently truncates the XML). These stay here rather than becoming
    // an `XmlRoptChunk` in `binary/render_chunks.py` alongside the other
    // `_ROPT_VARIANTS`: a typed variant never writes `Chunk.data`, so the
    // variable-length XML payload would have to move to `_trailing`,
    // which is `eq=False` - two modules with different render settings
    // would then compare equal, and any missed `.data` write would drop
    // the payload silently.
    body.set(bytes_.int_to_bytes(body.length, 4, "big"), _LEN_BODY_OFFSET);
    body.set(bytes_.int_to_bytes(xml_bytes.length - _XML_NULS.length, 4, "big"), _LEN_XML_OFFSET);
    this._body.data = new Uint8Array(body);
  }

  // -- read helpers ------------------------------------------------------

  /**
   * Look up an Adobe param and convert to an enum or int.
   *
   * Returns `None` when the param is absent or non-numeric.
   */
  _enum_param(key: string, enum_cls: any): any {
    const raw = dict_get(this.params, key, "");
    if (!py_bool(raw)) return null;
    return _try_enum_or_int(enum_cls, raw);
  }

  /**
   * The video codec as a [VideoCodec][] FourCC integer value extracted
   * from the `ADBEVideoCodec` parameter, or `None` for audio-only
   * formats (MP3, WAV). Falls back to a plain `int` when the codec is
   * not in the [VideoCodec][] enum.
   * Read / Write.
   */
  declare video_codec: any;

  /**
   * The audio codec as an [AudioCodec][] integer value extracted from
   * the `ADBEAudioCodec` parameter, or `None` when the parameter is
   * absent. Falls back to a plain `int` when the codec is not in the
   * [AudioCodec][] enum.
   * Read / Write.
   */
  declare audio_codec: any;

  /**
   * The output frame rate in frames per second, derived from the
   * `ADBEVideoFPS` parameter. Adobe stores this as ticks per frame
   * using a time base of 254,016,000,000 ticks/second, so
   * `frame_rate = 254016000000 / ADBEVideoFPS`.
   * `None` for audio-only formats (MP3, WAV).
   * Read / Write.
   */
  get frame_rate(): number | null {
    const fps_str = dict_get(this.params, "ADBEVideoFPS", "");
    if (!py_bool(fps_str)) return null;
    try {
      const ticks = int(fps_str);
      if (ticks > 0) return _ADOBE_TICKS_PER_SECOND / ticks;
    } catch (e) {
      if (!(e instanceof ValueError)) throw e;
    }
    return null;
  }

  set frame_rate(value: number | null) {
    if (value == null) return;
    _validate_number({ min: 1 / _ADOBE_TICKS_PER_SECOND })(value);
    const ticks = round(_ADOBE_TICKS_PER_SECOND / value);
    // BigInt keeps Python's exact int spelling for ticks >= 1e21.
    this._set_param("ADBEVideoFPS", BigInt(ticks).toString());
  }

  /**
   * The dialog's top-level `Audio Format` (AAC / MPEG / PCM) as an
   * [MPEGAudioFormat][] FourCC integer value extracted from the
   * `ADBEMPEGAudioFormat` parameter, or `None` when the parameter is
   * absent. Despite the parameter's `MPEG` prefix it selects among all
   * three families. Falls back to a plain `int` when the value is not
   * in the [MPEGAudioFormat][] enum.
   * Read / Write.
   */
  declare mpeg_audio_format: any;

  /**
   * The MPEG-1 audio layer as an [MPEGAudioLayer][] value extracted
   * from the `ADBEMPEGAudioLayer` parameter, or `None` when the
   * parameter is absent. Only meaningful when `mpeg_audio_format` is
   * `MPEGAudioFormat.MPEG`. Read / Write.
   */
  declare mpeg_audio_layer: any;

  /**
   * The AVI audio interleave interval as an [AudioInterleave][] value
   * extracted from the `ADBEAudioInterleave` parameter. The dialog's
   * `None` choice stores no parameter, so reads return `None` for it.
   * Read / Write.
   */
  declare audio_interleave: any;

  /**
   * The MP3 audio bitrate in kbps, from the `BitRate` parameter
   * (note: not ADBE-prefixed), or `None` when absent. Read / Write.
   */
  declare bitrate: any;

  /**
   * The H.264 audio bitrate in kbps, from the `ADBEAudioBitrate`
   * parameter, or `None` when absent. Read / Write.
   */
  declare audio_bitrate: any;

  /**
   * The H.264 encoding profile as an [MPEGProfile][] value from the
   * `ADBEVideoMPEGProfile` parameter. Read / Write.
   *
   * After Effects stores NO parameter for `Baseline`, so an absent
   * parameter reads back as `MPEGProfile.BASELINE` and assigning
   * `BASELINE` removes the parameter (AE-validated: the result matches
   * an AE-saved Baseline module's parameters exactly). The dropdown's
   * `Auto` is resolved at save time and reads back as `MAIN`. Falls
   * back to a plain `int` when the stored value is not in the
   * [MPEGProfile][] enum.
   */
  get profile(): any {
    const raw = dict_get(this.params, "ADBEVideoMPEGProfile", "");
    if (!py_bool(raw)) return MPEGProfile.BASELINE;
    const result = _try_enum_or_int(MPEGProfile, raw);
    // A non-numeric param is as good as absent.
    if (result == null) return MPEGProfile.BASELINE;
    return result;
  }

  set profile(value: any) {
    validate_enum(MPEGProfile)(value);
    if (MPEGProfile.of(value) === MPEGProfile.BASELINE) {
      this.params.pop("ADBEVideoMPEGProfile", "");
      return;
    }
    this._set_param("ADBEVideoMPEGProfile", str(int(value)));
  }

  /**
   * The H.264 encoding level as the raw integer from the
   * `ADBEVideoMPEGProfileLevel` parameter (level x 10, e.g. `41` for
   * 4.1; `100` is Unrestricted), or `None` when absent. Read / Write.
   */
  declare level: any;

  /**
   * The DNxHR/DNxHD resolution preset as a [DnxResolution][] value
   * extracted from the `ADBEVideoResolution` parameter, or `None` when
   * the parameter is absent. Only meaningful when `video_codec` is
   * `VideoCodec.DNXHR_DNXHD`; the param survives codec changes (stale
   * under other codecs). Falls back to a plain `int` when the value is
   * not in the [DnxResolution][] enum. Read / Write.
   */
  declare resolution: any;

  /**
   * The DNxHR/DNxHD `Alpha` choice from the `ADBEDNxHDAlphaType`
   * parameter: `1` = Compressed, `None` (param absent) = None. Only
   * meaningful when `video_codec` is `VideoCodec.DNXHR_DNXHD`.
   * (`ADBEVideoAlphaType` is unrelated - it reads `true` on every
   * sampled module.) Read / Write.
   */
  declare dnx_alpha_type: any;

  /**
   * The MPEG multiplexer as an [MPEGMultiplexer][] FourCC integer
   * value extracted from the `ADBEMPEGMultiplexer` parameter, or
   * `None` when the parameter is absent. Falls back to a plain `int`
   * when the value is not in the [MPEGMultiplexer][] enum.
   * Read / Write.
   */
  declare mpeg_multiplexer: any;

  /**
   * The MPEG mux stream compatibility as an
   * [MPEGMuxStreamCompatibility][] FourCC integer value extracted from
   * the `ADBEMPEGMuxStreamCompatibility` parameter, or `None` when the
   * parameter is absent. Falls back to a plain `int` when the value
   * is not in the [MPEGMuxStreamCompatibility][] enum.
   * Read / Write.
   */
  declare mpeg_mux_stream_compatibility: any;
}

// Descriptors assigned in the class body above, installed on the prototype
// in the Python class-body order (`__set_name__` runs inside `descriptor`).
descriptor(XmlFormatOptions, "format_code", new ChunkField("_body", "format_code", { read_only: true }));
descriptor(XmlFormatOptions, "video_codec", new _EnumParam("ADBEVideoCodec", VideoCodec));
descriptor(XmlFormatOptions, "audio_codec", new _EnumParam("ADBEAudioCodec", AudioCodec));
descriptor(XmlFormatOptions, "mpeg_audio_format", new _EnumParam("ADBEMPEGAudioFormat", MPEGAudioFormat));
descriptor(XmlFormatOptions, "mpeg_audio_layer", new _EnumParam("ADBEMPEGAudioLayer", MPEGAudioLayer));
descriptor(XmlFormatOptions, "audio_interleave", new _EnumParam("ADBEAudioInterleave", AudioInterleave));
descriptor(XmlFormatOptions, "bitrate", new _ScalarParam("BitRate"));
descriptor(XmlFormatOptions, "audio_bitrate", new _ScalarParam("ADBEAudioBitrate"));
descriptor(XmlFormatOptions, "level", new _ScalarParam("ADBEVideoMPEGProfileLevel"));
descriptor(XmlFormatOptions, "resolution", new _EnumParam("ADBEVideoResolution", DnxResolution));
descriptor(XmlFormatOptions, "dnx_alpha_type", new _ScalarParam("ADBEDNxHDAlphaType"));
descriptor(XmlFormatOptions, "mpeg_multiplexer", new _EnumParam("ADBEMPEGMultiplexer", MPEGMultiplexer));
descriptor(
  XmlFormatOptions,
  "mpeg_mux_stream_compatibility",
  new _EnumParam("ADBEMPEGMuxStreamCompatibility", MPEGMuxStreamCompatibility),
);
