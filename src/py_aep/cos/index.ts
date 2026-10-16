/** COS (Carousel Object Syntax) parser and serializer. */

export {
  CosName,
  CosParser,
  IndirectObject,
  IndirectReference,
  Stream,
  cos_get,
  run_spans,
} from "./cos.ts";
export { CosField } from "./descriptors.ts";
export { decode_pdf_text_string } from "./pdfdoc.ts";
export { serialize } from "./serializer.ts";
export { POINT_TEXT_COS_TEMPLATE, get_cos_template } from "./text.ts";
