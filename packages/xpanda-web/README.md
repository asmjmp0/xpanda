# xpanda-web

Browser-based UI for the xpanda decompiler — load a HarmonyOS `.abc` bytecode file or a `.hap`
app package and decompile it **entirely in the browser** (pure frontend, nothing is uploaded).

## Features

- Drag & drop anywhere, or click to pick a file (`.abc` / `.hap`, multiple files supported)
- `.hap` packages are unpacked in-memory; every `.abc` entry becomes a source with its own class list
- Class list with search and package grouping; click a single class to decompile it.
  Classes without a `func_main_0` entry (compiler metadata such as `L_ES*Annotation;`
  and `@ohos.*` / `@system.*` stubs) are hidden — they have no decompilable code,
  matching the CLI which never writes them.
- "Decompile all" runs every class with a live progress bar (main thread yields between classes, cancellable)
- Copy / download a single class as `.js`, or pack every decompiled class into a `.zip`
- Output mode toggle: **Optimized** (full simplify pipeline) or **Raw AST** output
- Lightweight dependency-free syntax highlighting with line numbers

## Run

```bash
npm install          # from the repo root (npm workspaces)
npm run web          # vite dev server → http://localhost:5173

# production build / preview
npm run build --workspace xpanda-web
npm run preview --workspace xpanda-web
```

## Structure

| Path | Responsibility |
|---|---|
| `src/decompiler.ts` | file loading (`.abc` / `.hap`), class indexing, `DecompileService` (cache + single/bulk decompile) |
| `src/highlight.ts` | zero-dependency line-based JavaScript syntax highlighter |
| `src/format.ts` | class demangle (shared rules with cli `io.ts`), clipboard, download helpers |
| `src/components/` | `Topbar` / `BulkBar` / `Sidebar` / `CodePane` |
| `src/App.tsx` | state wiring: drag & drop, selection, bulk progress |

The decompiler itself lives in `xpanda-core`, whose single entry (`src/index.ts`) is
browser-safe by design (no Node built-ins, no disk IO), so the same code powers the CLI and this UI.

> `index.html` defines a minimal `window.process = { env: {} }` shim: in dev, some
> pre-bundled dependencies (`@babel/types`, `@babel/code-frame`) read Node's `process`
> global at module init; the classic (non-module) inline script guarantees it exists
> before any bundled code evaluates. Don't remove it.
