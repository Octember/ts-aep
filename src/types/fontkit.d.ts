// fontkit 2.0.4 ships no type declarations, and @types/fontkit disagrees with
// its runtime (it misses `directory` and the lazily decoded table properties,
// requires getName's language, and only accepts a Node Buffer). This declares
// the API the port uses, checked against node_modules/fontkit/dist/module.mjs.
declare module "fontkit" {
  export interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    readonly width: number;
    readonly height: number;
  }

  export interface PathCommand {
    command: "moveTo" | "lineTo" | "quadraticCurveTo" | "bezierCurveTo" | "closePath";
    args: number[];
  }

  export interface Path {
    commands: PathCommand[];
    readonly bbox: BBox;
    readonly cbox: BBox;
    toSVG(): string;
  }

  export interface Glyph {
    id: number;
    codePoints: number[];
    readonly path: Path;
    readonly bbox: BBox;
    readonly cbox: BBox;
    readonly advanceWidth: number;
    readonly name: string;
  }

  export interface TableEntry {
    tag: string;
    checkSum: number;
    offset: number;
    length: number;
  }

  export interface VariationAxis {
    name: string;
    min: number;
    default: number;
    max: number;
  }

  export interface Font {
    readonly postscriptName: string | null;
    readonly familyName: string | null;
    readonly subfamilyName: string | null;
    readonly fullName: string | null;
    readonly unitsPerEm: number;
    readonly numGlyphs: number;
    readonly directory: { tag: string; numTables: number; tables: Record<string, TableEntry> };
    readonly variationAxes: Record<string, VariationAxis>;
    /** Tables decode lazily into properties named by tag; absent when the font has no such table. */
    readonly name?: { records: Record<string, Record<string, string>> };
    readonly hhea?: { ascent: number; descent: number; lineGap: number };
    /** `lang` defaults to the font's (or fontkit's) default language, `"en"`. */
    getName(key: string, lang?: string): string | null;
    glyphForCodePoint(codePoint: number): Glyph;
    getGlyph(id: number, codePoints?: number[]): Glyph;
    hasGlyphForCodePoint(codePoint: number): boolean;
  }

  /** A `.ttc` / `.dfont` collection: `create` returns this for collection files. */
  export interface FontCollection {
    readonly fonts: Font[];
    getFont(postscriptName: string): Font | null;
  }

  export function create(buffer: Uint8Array, postscriptName?: string): Font | FontCollection;
}
