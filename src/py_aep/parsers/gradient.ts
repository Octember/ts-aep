/** Parser and serializer for After Effects gradient XML in GCky Utf8 chunks. */

import {
  ValueError,
  dict_get,
  float,
  py_bool,
  py_or,
  range,
  warn,
} from "../../pyrt/index.ts";
import { Gradient, GradientAlphaStop, GradientColorStop } from "../models/properties/gradient.ts";
import type { Utf8Chunk } from "../binary/scalar_chunks.ts";

export const logger = {
  debug() {},
  info() {},
  warning: (m: string) => warn(m),
};

// TODO(pyrt): no xml.etree.ElementTree shim in pyrt. This is a local stand-in for the
// subset this file uses: `tag`, `.text` (leading character data, null when there is
// none), `find` / `findall` over direct children, and iteration over children.
// `fromstring` parses well-formed XML and throws `ParseError` otherwise.
export class ParseError extends Error {}

export class Element {
  text: string | null = null;
  readonly children: Element[] = [];

  constructor(readonly tag: string) {}

  find(tag: string): Element | null {
    for (const child of this.children) {
      if (child.tag === tag) return child;
    }
    return null;
  }

  findall(tag: string): Element[] {
    return this.children.filter((child) => child.tag === tag);
  }

  [Symbol.iterator](): Iterator<Element> {
    return this.children[Symbol.iterator]();
  }
}

export const XML_NAME = "[A-Za-z_][\\w.:-]*";
export const START_TAG = new RegExp(
  `<(${XML_NAME})((?:\\s+${XML_NAME}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>`,
  "y",
);
export const END_TAG = new RegExp(`</(${XML_NAME})\\s*>`, "y");
export const ENTITY_TOKEN = /&(?!#x[0-9a-fA-F]+;|#[0-9]+;|[A-Za-z]+;)/;
export const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

/** Decode character and entity references in a text run. */
export function decode_text(raw: string): string {
  if (ENTITY_TOKEN.test(raw)) throw new ParseError("not well-formed (invalid token)");
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (_m, ent: string) => {
    if (ent[0] === "#") {
      const cp = ent[1] === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return String.fromCodePoint(cp);
    }
    const named = NAMED_ENTITIES[ent];
    if (named === undefined) throw new ParseError(`undefined entity &${ent};`);
    return named;
  });
}

// TODO(pyrt): ElementTree.fromstring shim missing (see the Element note above).
export function fromstring(text: string): Element {
  // expat normalizes \r\n and lone \r to \n in character data
  text = text.replace(/\r\n?/g, "\n");
  let pos = 0;
  const stack: Element[] = [];
  let root: Element | null = null;

  while (pos < text.length) {
    if (text[pos] !== "<") {
      const next = text.indexOf("<", pos);
      const stop = next < 0 ? text.length : next;
      const chunk = text.slice(pos, stop);
      pos = stop;
      if (stack.length === 0) {
        if (!/^[ \t\r\n]*$/.test(chunk)) throw new ParseError("junk outside document element");
        continue;
      }
      // Character data before the first child is `.text`; after it, a child's tail.
      const top = stack[stack.length - 1];
      if (top.children.length === 0) top.text = (top.text ?? "") + decode_text(chunk);
      else decode_text(chunk);
    } else if (text.startsWith("<!--", pos)) {
      const end = text.indexOf("-->", pos + 4);
      if (end < 0) throw new ParseError("unclosed comment");
      pos = end + 3;
    } else if (text.startsWith("<![CDATA[", pos)) {
      const end = text.indexOf("]]>", pos + 9);
      if (end < 0 || stack.length === 0) throw new ParseError("unclosed CDATA section");
      const top = stack[stack.length - 1];
      if (top.children.length === 0) top.text = (top.text ?? "") + text.slice(pos + 9, end);
      pos = end + 3;
    } else if (text.startsWith("<?", pos)) {
      const end = text.indexOf("?>", pos + 2);
      if (end < 0) throw new ParseError("unclosed processing instruction");
      pos = end + 2;
    } else if (text.startsWith("<!DOCTYPE", pos)) {
      let end = pos + 2;
      let in_subset = false;
      while (end < text.length && !(text[end] === ">" && !in_subset)) {
        if (text[end] === "[") in_subset = true;
        else if (text[end] === "]") in_subset = false;
        end++;
      }
      if (end >= text.length) throw new ParseError("unclosed DOCTYPE");
      pos = end + 1;
    } else if (text.startsWith("</", pos)) {
      END_TAG.lastIndex = pos;
      const m = END_TAG.exec(text);
      const top = stack.pop();
      if (m === null || top === undefined || top.tag !== m[1]) {
        throw new ParseError("mismatched tag");
      }
      pos = END_TAG.lastIndex;
    } else {
      START_TAG.lastIndex = pos;
      const m = START_TAG.exec(text);
      if (m === null) throw new ParseError("syntax error");
      const el = new Element(m[1]);
      if (stack.length === 0) {
        if (root !== null) throw new ParseError("junk after document element");
        root = el;
      } else {
        stack[stack.length - 1].children.push(el);
      }
      if (m[3] !== "/") stack.push(el);
      pos = START_TAG.lastIndex;
    }
  }

  if (stack.length > 0) throw new ParseError("no element found");
  if (root === null) throw new ParseError("no element found");
  return root;
}

/**
 * Parse AE gradient XML into a `Gradient` instance.
 *
 * The XML uses a `prop.map` / `prop.list` / `prop.pair` structure with
 * nested arrays of floats for color and alpha stops.
 *
 * @param utf8 The Utf8 chunk containing the gradient XML.
 * @returns Parsed gradient data, or null if parsing fails.
 */
export function parse_gradient_xml(utf8: Utf8Chunk): Gradient | null {
  // String(): the value may be a `_NulTailStr` (String object), whose truthiness py_bool cannot see.
  const xml_text = String(utf8.value);
  if (!py_bool(xml_text)) return null;
  let root: Element;
  try {
    root = fromstring(xml_text);
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    logger.warning("Invalid gradient XML");
    return null;
  }

  // Navigate: prop.map > prop.list
  const prop_list = root.find("prop.list");
  if (prop_list == null) return null;

  const pairs = _get_pairs(prop_list);
  const gradient_data = dict_get(pairs, "Gradient Color Data");
  const version_str = _get_string_value(dict_get(pairs, "Gradient Colors"));

  if (gradient_data == null) return null;

  const data_pairs = _get_pairs(gradient_data);
  const color_stops = _parse_color_stops(dict_get(data_pairs, "Color Stops"));
  const alpha_stops = _parse_alpha_stops(dict_get(data_pairs, "Alpha Stops"));

  return Gradient._from_binary({
    color_stops,
    alpha_stops,
    version: py_or(version_str, "1.0"),
    _utf8: utf8,
  });
}

/**
 * Extract key-value pairs from a prop.list element.
 *
 * Returns a dict mapping key text to the value element (the second
 * child of each prop.pair).
 */
export function _get_pairs(prop_list_elem: Element): Map<string, Element> {
  const pairs = new Map<string, Element>();
  for (const pair of prop_list_elem.findall("prop.pair")) {
    const key_elem = pair.find("key");
    if (key_elem == null || key_elem.text == null) continue;
    // Value is the second child (after key)
    const children = [...pair];
    if (children.length >= 2) {
      pairs.set(key_elem.text, children[1]);
    }
  }
  return pairs;
}

/** Get text content from a <string> element. */
export function _get_string_value(elem: Element | null): string | null {
  if (elem == null) return null;
  if (elem.tag === "string") return elem.text;
  return null;
}

/** Parse the 'Color Stops' prop.list into GradientColorStop objects. */
export function _parse_color_stops(color_stops_elem: Element | null): GradientColorStop[] {
  if (color_stops_elem == null) return [];

  const pairs = _get_pairs(color_stops_elem);
  const stops_list_elem = dict_get(pairs, "Stops List");
  if (stops_list_elem == null) return [];

  const stops: GradientColorStop[] = [];
  // Each stop is a prop.pair with key "Stop-N"
  const stop_pairs = _get_pairs(stops_list_elem);
  for (const i of range(stop_pairs.size)) {
    const key = `Stop-${i}`;
    const stop_elem = dict_get(stop_pairs, key);
    if (stop_elem == null) break;
    const stop_inner = _get_pairs(stop_elem);
    const array_elem = dict_get(stop_inner, "Stops Color");
    if (array_elem == null) continue;
    const floats = _parse_float_array(array_elem);
    if (floats.length >= 5) {
      stops.push(
        new GradientColorStop(floats[0], floats[1], [floats[2], floats[3], floats[4]]),
      );
    }
  }
  return stops;
}

/** Parse the 'Alpha Stops' prop.list into GradientAlphaStop objects. */
export function _parse_alpha_stops(alpha_stops_elem: Element | null): GradientAlphaStop[] {
  if (alpha_stops_elem == null) return [];

  const pairs = _get_pairs(alpha_stops_elem);
  const stops_list_elem = dict_get(pairs, "Stops List");
  if (stops_list_elem == null) return [];

  const stops: GradientAlphaStop[] = [];
  const stop_pairs = _get_pairs(stops_list_elem);
  for (const i of range(stop_pairs.size)) {
    const key = `Stop-${i}`;
    const stop_elem = dict_get(stop_pairs, key);
    if (stop_elem == null) break;
    const stop_inner = _get_pairs(stop_elem);
    const array_elem = dict_get(stop_inner, "Stops Alpha");
    if (array_elem == null) continue;
    const floats = _parse_float_array(array_elem);
    if (floats.length >= 3) {
      stops.push(new GradientAlphaStop(floats[0], floats[1], floats[2]));
    }
  }
  return stops;
}

/** Parse an <array> element containing <float> children. */
export function _parse_float_array(array_elem: Element): number[] {
  const floats: number[] = [];
  for (const child of array_elem) {
    if (child.tag === "float" && child.text != null) {
      try {
        floats.push(float(child.text));
      } catch (e) {
        if (!(e instanceof ValueError)) throw e;
        continue;
      }
    }
  }
  return floats;
}
