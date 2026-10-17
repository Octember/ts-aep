// harfbuzzjs ships no type declarations. These cover the entry points
// resolvers/text_composition.ts loads, typed by the API subset it uses.
declare module "harfbuzzjs" {
  const hbjs: Promise<import("../py_aep/resolvers/text_composition.ts").HbJs>;
  export default hbjs;
}
declare module "harfbuzzjs/hb.js" {
  /** The emscripten factory for hb.wasm. */
  const hb_wasm: (options: { locateFile(file: string): string }) => Promise<object>;
  export default hb_wasm;
}
declare module "harfbuzzjs/hbjs.js" {
  const hbjs: (module: object) => import("../py_aep/resolvers/text_composition.ts").HbJs;
  export default hbjs;
}
