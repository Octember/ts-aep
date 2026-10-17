/**
 * The zod schemas of the text-document COS tree (`src/py_aep/cos/schema.ts`)
 * against real data: every `btdk` blob in the upstream samples, the
 * point-text template, and trees py_aep itself wrote. The library never runs
 * the schemas (py_aep does not validate COS), so this is what makes the
 * schema-derived types true for real files.
 *
 * Port-only: py-aep has no schemas.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { parse } from "../../src/py_aep/index.ts";
import { ListChunk, read_aep, type Chunk } from "../../src/py_aep/binary/chunk.ts";
import { CosParser } from "../../src/py_aep/cos/cos.ts";
import { serialize } from "../../src/py_aep/cos/serializer.ts";
import { btdk_cos, char_style } from "../../src/py_aep/cos/schema.ts";
import { get_cos_template } from "../../src/py_aep/cos/text.ts";
import { BytesIO, pyfloat } from "../../src/pyrt/index.ts";
import { TextDocument } from "../../src/py_aep/models/text/text_document.ts";
import { LineOrientation, ParagraphJustification } from "../../src/py_aep/enums/index.ts";

function* btdk_chunks(chunk: Chunk): Generator<ListChunk> {
  if (!(chunk instanceof ListChunk)) return;
  if (chunk.list_type === "btdk") yield chunk;
  for (const child of chunk.chunks ?? []) yield* btdk_chunks(child);
}

function issues(value: unknown): string[] {
  const result = btdk_cos.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("btdk schema", () => {
  test("every sample's btdk tree conforms", () => {
    const files = fs.globSync("samples/**/*.aep").sort();
    expect(files.length).toBe(644);
    let trees = 0;
    const failures: string[] = [];
    for (const file of files) {
      const [rifx] = read_aep(new BytesIO(new Uint8Array(fs.readFileSync(file))));
      for (const chunk of btdk_chunks(rifx)) {
        const cos = new CosParser(new BytesIO(chunk.data), chunk.data.length).parse();
        trees++;
        for (const issue of issues(cos)) failures.push(`${file}: ${issue}`);
      }
    }
    expect(failures).toEqual([]);
    expect(trees).toBe(239);
  }, 120_000);

  test("the point-text template conforms", () => {
    expect(issues(get_cos_template())).toEqual([]);
  });

  test("trees py_aep writes conform", () => {
    const app = parse("samples/models/text/text_writes.aep");
    const docs = app.project.compositions[0].text_layers.map((layer) => layer.text.source_text.value);
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      if (!(doc instanceof TextDocument)) continue;
      doc.text = "Hello\nwide world";
      doc.font = "Georgia";
      doc.fill_color = [0.25, 0.5, 0.75];
      doc.stroke_color = [1, 0, 0];
      doc.leading = 40;
      const range = doc.character_range(1, 4);
      range.kerning = 25;
      range.font_size = 18;
      doc.character_range(7, 9).justification = ParagraphJustification.CENTER_JUSTIFY;
      doc.character_range(0, 2).paste_from(doc.character_range(6, 9));
      doc.box_text_size = [300, 120];
      doc.box_inset_spacing = 4;
      expect(issues(doc._cos_data)).toEqual([]);
    }
    const fresh = new TextDocument("New\ntext", [200, 100], LineOrientation.VERTICAL_RIGHT_TO_LEFT);
    expect(issues(fresh._cos_data)).toEqual([]);
  });

  test("parsing returns the same tree, untouched", () => {
    const cos = get_cos_template();
    const before = serialize(cos);
    const result = btdk_cos.safeParse(cos);
    expect(result.success).toBe(true);
    expect(result.data).toBe(cos);
    expect(serialize(cos)).toEqual(before);
  });

  test("a non-conforming tree is reported, not thrown or changed", () => {
    const style = new Map<string, unknown>([["1", "36"], ["2", pyfloat(1.0)], ["999", "unknown keys pass"]]);
    const result = char_style.safeParse(style);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path.join("."))).toEqual(["1", "2"]);
    expect([...style.keys()]).toEqual(["1", "2", "999"]);
  });
});
