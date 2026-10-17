// Port of py_aep/cos/cos.py.
//
// source: https://gitlab.com/mattbas/python-lottie/-/blob/master/lib/lottie/parsers/aep/cos.py
// documentation: https://github.com/hunger-zh/lottie-docs/blob/main/docs/aep.md#list-btdk

import {
  at,
  auto,
  b,
  bytes_,
  bytes_eq,
  concat,
  decode,
  float,
  int,
  IndexError,
  OverflowError,
  py_assert,
  py_enum,
  py_eq,
  py_or,
  pyfloat,
  repr,
  str,
  SyntaxError_,
  TypeError_,
  UnicodeDecodeError,
  ValueError,
} from "../../pyrt/index.ts";
import type { EnumValue, IO } from "../../pyrt/index.ts";

export { SyntaxError_ };

// io.SEEK_CUR
export const SEEK_CUR = 1 as const;

// Python bytes.isspace(): ASCII whitespace only (space, \t, \n, \x0b, \x0c, \r).
export const WS_BYTES = [0x20, 0x09, 0x0a, 0x0b, 0x0c, 0x0d];

export function isspace_b(c: Uint8Array): boolean {
  return c.length > 0 && c.every((x) => WS_BYTES.includes(x));
}

// Python bytes.isdigit(): ASCII digits only.
export function isdigit_b(c: Uint8Array): boolean {
  return c.length > 0 && c.every((x) => x >= 0x30 && x <= 0x39);
}

// Python bytes.isalpha(): ASCII letters only.
export function isalpha_b(c: Uint8Array): boolean {
  return c.length > 0 && c.every((x) => (x >= 0x41 && x <= 0x5a) || (x >= 0x61 && x <= 0x7a));
}

// Lexer accumulators are ASCII (digits, signs, hex digits, keywords), so a
// latin1 string stands in for the Python bytes object while it is built.
export function latin1(c: Uint8Array): string {
  return String.fromCharCode(...c);
}

// Python's dataclass repr uses repr() on each field; dicts and lists need to
// recurse so nested Maps print like Python dicts.
export function repr_field(x: any): string {
  if (x instanceof Map) {
    return `{${[...x].map(([k, v]) => `${repr_field(k)}: ${repr_field(v)}`).join(", ")}}`;
  }
  if (Array.isArray(x)) return `[${x.map((y) => repr_field(y)).join(", ")}]`;
  if (x instanceof Uint8Array) return repr_bytes(x);
  return repr(x);
}

// CPython `repr(bytes)`: double quotes when the content has `'` but no `"`.
export function repr_bytes(x: Uint8Array): string {
  let has_single = false;
  let has_double = false;
  for (const c of x) {
    if (c === 0x27) has_single = true;
    else if (c === 0x22) has_double = true;
  }
  const quote = has_single && !has_double ? 0x22 : 0x27;
  let s = "";
  for (const c of x) {
    if (c === quote || c === 0x5c) s += "\\" + String.fromCharCode(c);
    else if (c === 0x09) s += "\\t";
    else if (c === 0x0a) s += "\\n";
    else if (c === 0x0d) s += "\\r";
    else if (c >= 0x20 && c < 0x7f) s += String.fromCharCode(c);
    else s += "\\x" + c.toString(16).padStart(2, "0");
  }
  const q = String.fromCharCode(quote);
  return `b${q}${s}${q}`;
}

// `str(member)` / `repr(member)` for an Enum member.
export function enum_str(E: any, v: any): string {
  return `${E.__name__}.${E.name_of(v)}`;
}

export function enum_repr(E: any, v: any): string {
  return `<${enum_str(E, v)}: ${v}>`;
}

/**
 * Safely traverse parsed COS data by successive keys.
 *
 * Each key is tried as a dict string key first and then as a list
 * index. Returns `None` when any step along the path is missing.
 *
 * @example
 * :
 *
 * cos_get(data, "1", "1", 0, "0", "0")  // -\> text string
 */
export function cos_get(data: any, ...keys: (string | number)[]): any {
  let cur: any = data;
  for (const key of keys) {
    if (cur == null) return null;
    if (cur instanceof Map) {
      cur = cur.get(str(key)) ?? null;
    } else if (Array.isArray(cur)) {
      try {
        cur = at(cur, int(key));
      } catch (e) {
        if (e instanceof IndexError || e instanceof ValueError || e instanceof TypeError_) return null;
        throw e;
      }
    } else {
      return null;
    }
  }
  return cur;
}

/**
 * Decode a text document's COS run array into `(start, end, payload)`.
 *
 * Run arrays (`doc["0"]["5"/"6"/"8"]["0"]`) store `{"0": payload, "1": count}` entries whose counts are UTF-16 units over the raw
 * text. `style_key` picks the style sub-dict for paragraph ("5") and
 * character ("6") runs; kerning runs ("8") use their payload directly.
 * Runs with a missing or negative count are skipped. Shared by the
 * range models (models/text/ranges.py) and the composed-line resolver
 * (resolvers/text_composition.py).
 */
export function run_spans(
  doc: Map<string, any>,
  doc_key: string,
  style_key: string | null,
): [number, number, Map<string, any>][] {
  const runs = cos_get(doc, "0", doc_key, "0");
  const spans: [number, number, Map<string, any>][] = [];
  if (!Array.isArray(runs)) return spans;
  let pos = 0;
  for (const run of runs) {
    const length: any = run instanceof Map ? run.get("1") ?? null : null;
    // Python `isinstance(True, int)` is True, so booleans count as lengths 1/0 (`int()` below).
    const is_int = typeof length === "boolean" || (typeof length === "number" && Number.isInteger(length));
    if (!is_int) continue;
    const n = int(length);
    if (n < 0) continue;
    let payload: any;
    if (style_key == null) {
      payload = cos_get(run, "0");
    } else {
      payload = cos_get(run, "0", "0", style_key);
    }
    spans.push([pos, pos + n, payload instanceof Map ? payload : new Map<string, any>()]);
    pos += n;
  }
  return spans;
}

export const TokenType = py_enum("TokenType", {
  Identifier: auto(), // /foo
  Number: auto(), // 123
  String: auto(), // (foo)
  HexString: auto(), // <f000>
  Boolean: auto(), // true
  ObjectStart: auto(), // <<
  ObjectEnd: auto(), // >>
  ArrayStart: auto(), // [
  ArrayEnd: auto(), // ]
  Null: auto(), // null
  Eof: auto(), // end of file
  IndirectObjectStart: auto(), // obj
  IndirectObjectEnd: auto(), // endobj
  IndirectReference: auto(), // R
  Stream: auto(), // stream...endstream
});
export type TokenType = EnumValue<typeof TokenType>;

/** `@dataclass class Token` */
export class Token {
  declare type: TokenType;
  declare value: any;

  constructor(type: TokenType, value: any = null) {
    this.type = type;
    this.value = value;
  }

  __repr__(): string {
    return `Token(type=${enum_repr(TokenType, this.type)}, value=${repr_field(this.value)})`;
  }

  __eq__(other: any): boolean {
    return other instanceof Token && this.type === other.type && py_eq(this.value, other.value);
  }
}

/** `@dataclass class IndirectObject` */
export class IndirectObject {
  declare object_number: number;
  declare generation_number: number;
  declare data: any;

  constructor(object_number: number, generation_number: number, data: any) {
    this.object_number = object_number;
    this.generation_number = generation_number;
    this.data = data;
  }

  __repr__(): string {
    return `IndirectObject(object_number=${repr(this.object_number)}, generation_number=${repr(this.generation_number)}, data=${repr_field(this.data)})`;
  }

  __eq__(other: any): boolean {
    return (
      other instanceof IndirectObject &&
      this.object_number === other.object_number &&
      this.generation_number === other.generation_number &&
      py_eq(this.data, other.data)
    );
  }
}

/** `@dataclass class IndirectReference` */
export class IndirectReference {
  declare object_number: number;
  declare generation_number: number;

  constructor(object_number: number, generation_number: number) {
    this.object_number = object_number;
    this.generation_number = generation_number;
  }

  __repr__(): string {
    return `IndirectReference(object_number=${repr(this.object_number)}, generation_number=${repr(this.generation_number)})`;
  }

  __eq__(other: any): boolean {
    return (
      other instanceof IndirectReference &&
      this.object_number === other.object_number &&
      this.generation_number === other.generation_number
    );
  }
}

/**
 * A COS string literal that remembers its on-disk encoding.
 *
 * After Effects writes some string literals as UTF-16 BE (with a BOM,
 * e.g. visible text) and others as raw ASCII / UTF-8 (e.g. bit-flag
 * strings like `00001000...`). The encoding cannot be inferred from
 * the decoded content, so it is preserved here for byte-faithful
 * re-serialization. Behaves exactly like `str` otherwise. New strings
 * created without this wrapper default to UTF-16 on write.
 */
export class CosString extends String {
  /** Whether the literal was UTF-16 BE (the default for new strings). */
  declare cos_utf16: boolean;
  /**
   * The literal's own bytes, kept only when no byte-order mark said how
   * to read them and the lexer fell back to UTF-8. A PDF *text* string
   * with no BOM is PDFDocEncoding instead (PDF 32000-1 7.9.2.2), which
   * only the consumer knows to apply - see `decode_pdf_text_string`.
   * `null` whenever a BOM settled the encoding.
   */
  declare cos_raw: Uint8Array | null;

  constructor(value: string, kw: { utf16?: boolean; raw?: Uint8Array | null } = {}) {
    super(value);
    const { utf16 = true, raw = null } = kw;
    this.cos_utf16 = utf16;
    this.cos_raw = raw;
  }
}

/** A COS name object used as a value (e.g. `/CoolTypeFont`). */
export class CosName {
  /**
   * Distinct from a dict key identifier: when serialized, a CosName
   * writes `/name` while a plain `str` writes `(string)`.
   */
  declare value: string;

  constructor(value: string) {
    this.value = value;
  }

  __str__(): string {
    return this.value;
  }

  toString(): string {
    return this.__str__();
  }

  __repr__(): string {
    return `CosName(value=${repr(this.value)})`;
  }

  __eq__(other: any): boolean {
    return other instanceof CosName && py_eq(this.value, other.value);
  }
}

/** `@dataclass class Stream` */
export class Stream {
  declare dictionary: Map<string, any>;
  declare data: Uint8Array;

  constructor(dictionary: Map<string, any>, data: Uint8Array) {
    this.dictionary = dictionary;
    this.data = data;
  }

  __repr__(): string {
    return `Stream(dictionary=${repr_field(this.dictionary)}, data=${repr_bytes(this.data)})`;
  }

  __eq__(other: any): boolean {
    return other instanceof Stream && py_eq(this.dictionary, other.dictionary) && py_eq(this.data, other.data);
  }
}

export class CosParser {
  declare file: IO;
  declare max_pos: number | null;
  declare lookahead: Token;

  constructor(file: IO, max_pos: number | null = null) {
    this.file = file;
    this.max_pos = max_pos;
    this.lookahead = new Token(TokenType.Eof);
  }

  parse(): any {
    this.lex();
    if (this.lookahead.type === TokenType.Identifier) return this.parse_dict_content();

    const val = this.parse_value();
    if (this.lookahead.type === TokenType.Eof) return val;

    return [val, ...this.parse_array_content()];
  }

  parse_value(): any {
    if (this.lookahead.type === TokenType.Identifier) {
      const val = new CosName(this.lookahead.value);
      this.lex();
      return val;
    }

    if (
      this.lookahead.type === TokenType.String ||
      this.lookahead.type === TokenType.HexString ||
      this.lookahead.type === TokenType.Null ||
      this.lookahead.type === TokenType.Boolean ||
      this.lookahead.type === TokenType.Stream
    ) {
      const val = this.lookahead.value;
      this.lex();
      return val;
    }

    if (this.lookahead.type === TokenType.Number) {
      const val = this.lookahead.value;
      this.lex();
      if (this.lookahead.type === TokenType.Number) {
        const gen = this.lookahead.value;
        const state = this.save_state();
        this.lex();
        if (this.lookahead.type === TokenType.IndirectObjectStart) {
          this.lex();
          const data = this.parse_value();
          this.expect(TokenType.IndirectObjectEnd);
          this.lex();
          return new IndirectObject(val, gen, data);
        } else if (this.lookahead.type === TokenType.IndirectReference) {
          this.lex();
          return new IndirectReference(val, gen);
        } else {
          this.restore_state(state);
        }
      }
      return val;
    }

    if (this.lookahead.type === TokenType.ObjectStart) {
      this.lex();
      let val: any = this.parse_dict_content();
      this.expect(TokenType.ObjectEnd);
      this.lex();
      if (this.lookahead.type === TokenType.Stream) {
        val = new Stream(val, this.lookahead.value);
        this.lex();
      }
      return val;
    }

    if (this.lookahead.type === TokenType.ArrayStart) {
      this.lex();
      const val = this.parse_array_content();
      this.expect(TokenType.ArrayEnd);
      this.lex();
      return val;
    }

    throw new SyntaxError_(`Expected COS value, got ${str(this.lookahead)}`);
  }

  save_state(): [number | null, number, Token] {
    return [this.max_pos, this.file.tell(), this.lookahead];
  }

  restore_state(state: [number | null, number, Token]): void {
    const [max_pos, pos, lookahead] = state;
    this.max_pos = max_pos;
    this.lookahead = lookahead;
    this.file.seek(pos);
  }

  parse_dict_content(): Map<string, any> {
    const value = new Map<string, any>();
    while (true) {
      if (this.lookahead.type === TokenType.Eof || this.lookahead.type === TokenType.ObjectEnd) {
        break;
      }

      this.expect(TokenType.Identifier);
      const key = this.lookahead.value;
      this.lex();
      const val = this.parse_value();
      value.set(key, val);
    }

    return value;
  }

  parse_array_content(): any[] {
    const value: any[] = [];
    while (true) {
      if (this.lookahead.type === TokenType.Eof || this.lookahead.type === TokenType.ArrayEnd) {
        break;
      }
      value.push(this.parse_value());
    }
    return value;
  }

  expect(token_type: TokenType): void {
    if (this.lookahead.type !== token_type) {
      throw new SyntaxError_(`Expected ${enum_str(TokenType, token_type)}, got ${str(this.lookahead)}`);
    }
  }

  lex(): void {
    this.lookahead = this.lex_token();
  }

  lex_token(): Token {
    let char: Uint8Array | null = null;
    while (true) {
      char = this.get_char();
      if (char == null) {
        return new Token(TokenType.Eof);
      } else if (bytes_eq(char, b("%"))) {
        this.lex_comment();
      } else if (!isspace_b(char)) {
        break;
      }
    }

    // At this point char is guaranteed to be bytes (not None)
    py_assert(char != null);

    // <<
    if (bytes_eq(char, b("<"))) {
      const next_char = this.get_char();
      if (bytes_eq(next_char, b("<"))) {
        return new Token(TokenType.ObjectStart);
      } else if (next_char == null) {
        return this.raise_lex(b("<"));
      } else if (this.is_hex(next_char)) {
        return this.lex_hex_string(next_char);
      } else {
        return this.raise_lex(concat(b("<"), next_char));
      }
    }

    // >>
    if (bytes_eq(char, b(">"))) {
      this.expect_char(b(">"), char);
      return new Token(TokenType.ObjectEnd);
    }

    // [
    if (bytes_eq(char, b("["))) {
      return new Token(TokenType.ArrayStart);
    }

    // ]
    if (bytes_eq(char, b("]"))) {
      return new Token(TokenType.ArrayEnd);
    }

    // /foo
    if (bytes_eq(char, b("/"))) {
      return this.lex_identifier();
    }

    // (foo)
    if (bytes_eq(char, b("("))) {
      return this.lex_string();
    }

    // Keyword
    if (isalpha_b(char)) {
      return this.lex_keyword(char);
    }

    // Number
    if (isdigit_b(char) || bytes_.contains(b(".+-"), char)) {
      return this.lex_number(char);
    }

    return this.raise_lex(char);
  }

  expect_char(exp: Uint8Array, head: Uint8Array): void {
    const char = this.get_char();
    if (char == null || !bytes_eq(char, exp)) {
      this.raise_lex(concat(head, char?.length > 0 ? char : bytes_.EMPTY), concat(head, exp));
    }
  }

  raise_lex(token: Uint8Array, exp: Uint8Array | null = null): never {
    let msg = `Unknown COS token ${repr_bytes(token)}`;
    if (exp != null) msg += `, expected ${repr_bytes(exp)}`;
    throw new SyntaxError_(msg);
  }

  get_char(): Uint8Array | null {
    if (this.max_pos != null) {
      if (this.max_pos <= 0) return null;
      this.max_pos -= 1;
    }
    // `read(1)` gives `b""` at the end of the data. Every lexer loop stops
    // on `None`, so passing `b""` on spun them forever on a truncated
    // document (an empty byte also matched `in b".+-"` as a number start).
    return py_or(this.file.read(1), null);
  }

  unget(): void {
    this.file.seek(-1, SEEK_CUR);
    if (this.max_pos != null) this.max_pos += 1;
  }

  // Skip until newline
  lex_comment(): void {
    while (true) {
      const char = this.get_char();
      if (bytes_eq(char, b("\n"))) {
        break;
      } else if (char == null) {
        break;
      }
    }
  }

  lex_number(char: Uint8Array): Token {
    if (bytes_eq(char, b("."))) {
      return this.lex_num_fract(this.get_char(), latin1(char));
    } else if (bytes_eq(char, b("+")) || bytes_eq(char, b("-"))) {
      return this.lex_num_int(this.get_char(), latin1(char));
    } else {
      return this.lex_num_int(char, "");
    }
  }

  lex_num_int(char: Uint8Array | null, head: string): Token {
    while (true) {
      if (char == null) {
        break;
      } else if (bytes_eq(char, b("."))) {
        return this.lex_num_fract(this.get_char(), head + latin1(char));
      } else if (isdigit_b(char)) {
        head += latin1(char);
        char = this.get_char();
      } else {
        this.unget();
        break;
      }
    }
    // TODO(port): Python's int() is unbounded but int(head) here yields a JS number, so COS integer literals beyond 2**53 (e.g. 9007199254740993) round to the nearest double.
    // Python's int() gets bytes, so its error message shows b'+' rather than '+'.
    let value: number;
    try {
      value = int(head);
    } catch (e) {
      if (e instanceof ValueError) {
        throw new ValueError(`invalid literal for int() with base 10: b'${head}'`);
      }
      throw e;
    }
    // `+ 0` turns int("-0") from -0 into 0 like Python.
    return new Token(TokenType.Number, value + 0);
  }

  lex_num_fract(char: Uint8Array | null, head: string): Token {
    while (true) {
      if (char == null) {
        break;
      } else if (isdigit_b(char)) {
        head += latin1(char);
        char = this.get_char();
      } else {
        this.unget();
        break;
      }
    }
    // Boxed so an integral float ("2.0") stays a float through copies and re-serialization.
    return new Token(TokenType.Number, pyfloat(float(head)));
  }

  lex_keyword(char: Uint8Array): Token {
    // Keywords are ASCII letters only (`isalpha_b`), so a latin1 string holds them exactly.
    let kw = latin1(char);
    while (true) {
      const next_char = this.get_char();
      if (next_char == null) {
        break;
      } else if (isalpha_b(next_char)) {
        kw += latin1(next_char);
      } else {
        this.unget();
        break;
      }
    }

    if (kw === "true") {
      return new Token(TokenType.Boolean, true);
    } else if (kw === "false") {
      return new Token(TokenType.Boolean, false);
    } else if (kw === "null") {
      return new Token(TokenType.Null, null);
    } else if (kw === "obj") {
      return new Token(TokenType.IndirectObjectStart);
    } else if (kw === "endobj") {
      return new Token(TokenType.IndirectObjectEnd);
    } else if (kw === "R") {
      return new Token(TokenType.IndirectReference);
    } else if (kw === "stream") {
      return this.lex_stream();
    } else if (kw === "xref") {
      return new Token(TokenType.Eof);
    } else {
      throw new SyntaxError_(`Unknown keyword ${repr_bytes(b(kw))}`);
    }
  }

  lex_stream(): Token {
    const char = this.get_char();
    if (bytes_eq(char, b("\r"))) {
      if (!bytes_eq(this.get_char(), b("\n"))) throw new SyntaxError_("Invalid newline");
    } else if (!bytes_eq(char, b("\n"))) {
      throw new SyntaxError_("Expected newline after `stream`");
    }

    // Read in blocks up to the first `endstream`: a byte at a time (with a
    // growing bytes object) took seconds for a 0.5 MB embedded ICC profile.
    // `stream` is a bytearray: a buffer we own, grown by doubling.
    const marker = b("endstream");
    let stream = new Uint8Array(65536);
    let stream_len = 0;
    while (true) {
      const size = this.max_pos == null ? 65536 : Math.min(65536, this.max_pos);
      const block = size > 0 ? this.file.read(size) : bytes_.EMPTY;
      if (!block.length) throw new SyntaxError_("Unterminated stream");
      if (this.max_pos != null) this.max_pos -= block.length;
      const search_from = Math.max(0, stream_len - marker.length + 1);
      if (stream_len + block.length > stream.length) {
        const grown = new Uint8Array(Math.max(stream_len + block.length, stream.length * 2));
        grown.set(stream.subarray(0, stream_len));
        stream = grown;
      }
      stream.set(block, stream_len);
      stream_len += block.length;
      const end = bytes_.find(stream.subarray(0, stream_len), marker, search_from);
      if (end >= 0) {
        // Give back what was read past the marker.
        const extra = stream_len - end - marker.length;
        this.file.seek(-extra, SEEK_CUR);
        if (this.max_pos != null) this.max_pos += extra;
        return new Token(TokenType.Stream, stream.slice(0, end));
      }
    }
  }

  lex_string(): Token {
    // Read the entire string content first
    const acc: number[] = [];
    while (true) {
      const char = this.lex_string_char();
      if (char == null) break;
      for (const c of char) acc.push(c);
    }
    let string: Uint8Array = Uint8Array.from(acc);

    // Default to UTF-8 encoding
    let encoding = "utf-8";
    let no_bom = false;

    // Check for BOM at the start of the string and remove it
    if (bytes_.startswith(string, b("\xef\xbb\xbf"))) {
      // UTF-8 BOM - remove it (3 bytes)
      string = bytes_.slice(string, 3);
    } else if (bytes_.startswith(string, b("\xfe\xff"))) {
      // UTF-16 BE BOM - remove it (2 bytes)
      string = bytes_.slice(string, 2);
      encoding = "utf-16-be";
    } else if (bytes_.startswith(string, b("\xff\xfe"))) {
      // UTF-16 LE BOM - remove it (2 bytes)
      string = bytes_.slice(string, 2);
      encoding = "utf-16-le";
    } else {
      no_bom = true;
    }

    let decoded: string;
    try {
      decoded = decode(string, encoding);
    } catch (e) {
      if (!(e instanceof UnicodeDecodeError)) throw e;
      return new Token(TokenType.String, string);
    }
    return new Token(
      TokenType.String,
      new CosString(decoded, {
        utf16: encoding === "utf-16-be",
        raw: no_bom ? string : null,
      }),
    );
  }

  lex_string_char(): Uint8Array | null {
    const char = this.get_char();
    if (char == null) {
      throw new SyntaxError_("Unterminated string");
    } else if (bytes_eq(char, b(")"))) {
      return null;
    } else if (bytes_eq(char, b("\\"))) {
      return this.lex_string_escape();
    } else {
      // AE's COS strings hold binary UTF-16 data, so a raw 0x0d / 0x0a
      // byte is part of a character (e.g. U+300D), not a line ending.
      // Preserve it verbatim - normalizing CR/CRLF to LF (per the COS
      // spec for text) would corrupt the data and break round-trip.
      return char;
    }
  }

  lex_string_escape(): Uint8Array {
    const char = this.get_char();
    if (char == null) throw new SyntaxError_("Unterminated string");

    if (bytes_eq(char, b("n"))) {
      return b("\n");
    } else if (bytes_eq(char, b("r"))) {
      return b("\r");
    } else if (bytes_eq(char, b("b"))) {
      return b("\b");
    } else if (bytes_eq(char, b("f"))) {
      return b("\f");
    } else if (bytes_eq(char, b("("))) {
      return b("(");
    } else if (bytes_eq(char, b(")"))) {
      return b(")");
    } else if (bytes_eq(char, b("\\"))) {
      return b("\\");
    } else if (this.is_octal(char)) {
      let octal = char[0] - 0x30; // ord(b"0")
      for (let k = 0; k < 2; k++) {
        const next_char = this.get_char();
        if (next_char == null) {
          break;
        } else if (!this.is_octal(next_char)) {
          this.unget();
          break;
        }
        octal = octal * 8 + next_char[0] - 0x30;
      }
      // Python's `octal.to_bytes(1, "big")`: values past one byte overflow.
      if (octal > 255) throw new OverflowError("int too big to convert");
      return Uint8Array.of(octal);
    }

    throw new SyntaxError_("Invalid escape sequence");
  }

  is_octal(char: Uint8Array): boolean {
    return char[0] >= 0x30 && char[0] <= 0x37; // b"0" <= char <= b"7"
  }

  is_hex(char: Uint8Array): boolean {
    return isdigit_b(char) || (char[0] >= 0x61 && char[0] <= 0x66) || (char[0] >= 0x41 && char[0] <= 0x46);
  }

  lex_hex_string(hstr_first: Uint8Array): Token {
    let hstr = latin1(hstr_first);
    while (true) {
      const char = this.get_char();
      if (char == null) {
        throw new SyntaxError_("Unterminated hex string");
      } else if (this.is_hex(char)) {
        hstr += latin1(char);
      } else if (bytes_eq(char, b(">"))) {
        break;
      } else if (!isspace_b(char)) {
        throw new SyntaxError_(`Invalid character in hex string: ${repr_bytes(char)}`);
      }
    }

    if (hstr.length % 2) hstr += "0";

    const data = new Uint8Array(hstr.length / 2);
    for (let i = 0; i < hstr.length; i += 2) {
      data[i / 2] = int(hstr.slice(i, i + 2), 16);
    }
    return new Token(TokenType.HexString, data);
  }

  lex_identifier(): Token {
    let ident = "";
    const special = b("()[]<>{}/%");
    while (true) {
      let char = this.get_char();
      if (char == null) {
        break;
      } else if (char[0] < 0x21 || char[0] > 0x7e) {
        // char < b"!" or char > b"~"
        this.unget();
        break;
      } else if (bytes_eq(char, b("#"))) {
        let hexstr = "";
        for (let k = 0; k < 2; k++) {
          char = this.get_char();
          if (char == null || !this.is_hex(char)) throw new SyntaxError_("Invalid identifier");
          hexstr += latin1(char);
        }
        ident += String.fromCodePoint(int(hexstr, 16));
      } else if (bytes_.contains(special, char)) {
        this.unget();
        break;
      } else {
        ident += String.fromCodePoint(char[0]);
      }
    }

    return new Token(TokenType.Identifier, ident);
  }
}
