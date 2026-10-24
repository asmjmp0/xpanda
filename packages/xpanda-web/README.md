# xpanda-web

Browser-based UI for the xpanda decompiler — load a HarmonyOS `.abc` bytecode file or a `.hap`
app package and decompile it **entirely in the browser** (pure frontend, nothing is uploaded).

## Features

- Drag & drop anywhere, or click to pick a file (`.abc` / `.hap`, multiple files supported)
- No network requests: everything runs locally in the browser — no files or other information
  are sent to a server
- Multiple files can be dropped at once or added one after another; each loaded file is a
  collapsible section in the sidebar
- `.hap` packages are unpacked in-memory; every `.abc` entry becomes a source with its own class list
- Class list with search and package grouping; click a single class to decompile it.
  Classes without a `func_main_0` entry (compiler metadata such as `L_ES*Annotation;`
  and `@ohos.*` / `@system.*` stubs) are hidden — they have no decompilable code,
  matching the CLI which never writes them.
- "Decompile all" runs every class with a live progress bar (cancellable). In optimized mode the
  expensive `simplify` pass runs in a pool of Web Workers (1–8 threads, default 4, same split as
  the CLI `-j`: main thread builds the AST, workers optimize); the thread count is selectable in
  the toolbar and remembered in `localStorage`; raw mode stays single-threaded
- Copy / download a single class as `.js`, or pack every decompiled class into a `.zip`
- The code pane shows how long the selected class took to decompile (first run, per output mode)
- Output mode toggle: **Optimized** (full simplify pipeline) or **Raw AST** output
- Lightweight dependency-free syntax highlighting with line numbers
- Topbar shows the `xpanda-core` / `xpanda-web` versions (read from their `package.json`) and links to the GitHub repository

## Disclaimer / 申明

- **Local only / 仅在本地运行**: all parsing and decompilation happen entirely in your browser.
  The app never uploads files, decompiled code, or any other information to a server.
  本反编译器完全在浏览器本地运行，不会向服务器传输任何文件、代码或其他信息。
- **For learning and research only / 仅供学习研究**: do not use xpanda for any illegal or
  unauthorized purpose. Decompiling third-party software may infringe copyright, trade secrets
  or software licenses; only process files you own or are authorized to analyze. You are
  responsible for any consequences of using this tool.
  本项目仅供学习研究，请勿用于任何违法违规场景；请确保你拥有目标文件的合法权利或授权，使用本工具产生的一切风险与后果由使用者自行承担。

Project repository / 项目仓库: <https://github.com/asmjmp0/xpanda>

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
