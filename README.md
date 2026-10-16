# ts-aep

A 1:1 TypeScript port of [py-aep](https://github.com/forticheprod/py-aep), the
After Effects `.aep` reader/writer, pinned to upstream commit
`edcae7a` (see `UPSTREAM_COMMIT`).

Every Python module, class and function has a twin with the same name at the
same path (`src/py_aep/a/b.py` → `src/py_aep/a/b.ts`), so upstream changes sync
file by file. Python semantics the port depends on (rounding, floor division,
`struct`, `surrogateescape`, attrs, enums, descriptors, ElementTree, …) live in
`src/pyrt/`. Translation rules: `RULEBOOK.md`.

## Status

Against upstream at the pinned commit, on the same machine:

- Test suite: all 15,431 upstream tests translated to `bun:test`; 15,369 pass,
  62 skip on missing system fonts / OCIO configs / AE preferences — identical to
  CPython 3.12. (Runtime skips report as passes in bun's tally.)
- Parse → save is byte-identical on all 644 upstream sample projects
  (`bun tools/corpus_roundtrip.ts`), same as py-aep.
- `tsc` is non-strict and still reports ~2,000 typing errors; 219 `TODO(port)`
  markers flag spots where parity rests on tests rather than a proven-exact port.

## Use

```bash
bun install
tools/fetch-samples.sh   # upstream checkout + LFS samples (~240 MB)
bun test
```

Requires Bun (or Node 22+ for `require()` of ESM, used by `pyrt/deferred.ts`).

## License

MIT. Derived from py-aep, Copyright (c) 2023 Fortiche production; see `LICENSE`.
