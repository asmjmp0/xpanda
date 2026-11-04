import type { WriteStream } from "tty";

/**
 * Live decompile progress on stderr.
 *
 * Interactive terminals get an in-place panel: class total, the class the main
 * thread is decompiling, and the class each simplify worker is optimizing.
 * `--quiet` constructs this with enabled=false, which drops the panel.
 * @Author: jmp0
 */

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BAR_WIDTH = 20;

export interface ProgressSnapshot {
    title: string;
    total: number;
    done: number;
    elapsedMs: number;
    /** Class the main thread is turning into an AST; null when idle. */
    decompiling: string | null;
    /** Serial in-process simplify. Ignored when `workers` is set. */
    simplify: string | null;
    /** One entry per simplify worker; null means that worker is idle. Null array means serial. */
    workers: Array<string | null> | null;
    /** ASTs built on the main thread and waiting for a free simplify worker. */
    queued: number;
    showSimplify: boolean;
    columns: number;
    color: boolean;
    /** Index into the braille spinner. */
    spinner: number;
}

export function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const seconds = total % 60;
    const minutes = Math.floor(total / 60) % 60;
    const hours = Math.floor(total / 3600);
    if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m${String(seconds).padStart(2, "0")}s`;
    if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
    return `${seconds}s`;
}

/** Keep the tail of a long class name; the leaf is the part worth reading. */
export function truncateName(name: string, max: number): string {
    if (max < 1) return "";
    if (name.length <= max) return name;
    if (max === 1) return "…";
    return "…" + name.slice(name.length - (max - 1));
}

function paint(color: boolean, code: string, text: string): string {
    return color ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/** Visible columns, skipping CSI color sequences so a tinted line is not clipped mid-code. */
function clipVisible(text: string, max: number): string {
    if (max < 1) return "";
    let visible = 0;
    let out = "";
    for (let i = 0; i < text.length;) {
        if (text.charCodeAt(i) === 0x1b && text[i + 1] === "[") {
            const end = text.indexOf("m", i);
            if (end < 0) break;
            out += text.slice(i, end + 1);
            i = end + 1;
            continue;
        }
        if (visible >= max) {
            if (text.includes("\x1b[")) out += "\x1b[0m";
            return out;
        }
        out += text[i];
        visible++;
        i++;
    }
    return out;
}

export function renderProgress(state: ProgressSnapshot): string[] {
    const ratio = state.total === 0 ? 0 : state.done / state.total;
    let filled = Math.round(ratio * BAR_WIDTH);
    if (state.done > 0 && filled < 1) filled = 1;
    if (state.total > 0 && state.done >= state.total) filled = BAR_WIDTH;
    filled = Math.max(0, Math.min(BAR_WIDTH, filled));
    const bar = paint(state.color, "38;5;43", "█".repeat(filled))
        + paint(state.color, "38;5;238", "░".repeat(BAR_WIDTH - filled));
    const countWidth = String(state.total).length * 2 + 1;
    const counts = `${state.done}/${state.total}`.padStart(countWidth);
    const percent = `${Math.floor(ratio * 100)}%`.padStart(4);
    const noun = state.total === 1 ? "class" : "classes";
    const title = truncateName(`${state.title}   ${state.total} ${noun}`, Math.max(8, state.columns));
    const queueTone = state.queued > 0 ? "36" : "2";
    const queueSuffix = state.workers !== null
        ? `  ${paint(state.color, queueTone, `queue ${state.queued}`)}`
        : "";
    const head = `${bar}  ${paint(state.color, "1", counts)} ${percent}  ${formatElapsed(state.elapsedMs)}${queueSuffix}`;

    type Row = { label: string; tone: string; name: string | null; worker: boolean };
    const rows: Row[] = [{ label: "decompile", tone: "33", name: state.decompiling, worker: false }];
    if (state.workers) {
        state.workers.forEach((name, index) => {
            rows.push({ label: `worker ${index + 1}`, tone: "35", name, worker: true });
        });
    } else if (state.showSimplify) {
        rows.push({ label: "simplify", tone: "35", name: state.simplify, worker: false });
    }
    const labelWidth = Math.max(...rows.map((row) => row.label.length));
    const phaseWidth = rows.some((row) => row.worker) ? "simplify".length : 0;
    const prefix = 1 + 1 + labelWidth + 2 + (phaseWidth === 0 ? 0 : phaseWidth + 2);
    const nameMax = Math.max(8, state.columns - prefix);
    const glyphAt = SPINNER[state.spinner % SPINNER.length];

    const lines = [paint(state.color, "1", title), head];
    for (const row of rows) {
        const active = row.name !== null;
        const glyph = active ? glyphAt : " ";
        const label = paint(state.color, row.tone, row.label.padEnd(labelWidth));
        const phase = phaseWidth === 0
            ? ""
            : `${(row.worker && active ? "simplify" : "").padEnd(phaseWidth)}  `;
        const shown = active ? truncateName(row.name!, nameMax) : paint(state.color, "2", "idle");
        lines.push(`${glyph} ${label}  ${phase}${shown}`);
    }
    return lines.map((line) => clipVisible(line, Math.max(1, state.columns)));
}

export class DecompileProgress {
    private readonly tty: boolean;
    private readonly color: boolean;
    private active = false;
    private startedAt = 0;
    private drawn = 0;
    private cursorHidden = false;
    private frame = 0;
    private timer: ReturnType<typeof setInterval> | null = null;
    private title = "";
    private total = 0;
    private done = 0;
    private decompiling: string | null = null;
    private simplify: string | null = null;
    private workers: Array<string | null> | null = null;
    private queued = 0;
    private showSimplify = false;

    constructor(private readonly enabled: boolean, private readonly stream: WriteStream = process.stderr) {
        this.tty = enabled && !!stream.isTTY && process.env.TERM !== "dumb";
        this.color = this.tty && !process.env.NO_COLOR;
        if (this.tty) process.on("exit", () => this.restoreCursor());
    }

    /** True when the in-place panel is on the terminal, so per-class stdout logs would tear it. */
    get live(): boolean {
        return this.tty;
    }

    begin(title: string, total: number, workerSlots: number, showSimplify: boolean): void {
        if (!this.enabled) return;
        this.stopTimer();
        if (this.drawn > 0) this.clear();
        this.title = title;
        this.total = total;
        this.done = 0;
        this.decompiling = null;
        this.simplify = null;
        this.workers = workerSlots > 0 ? new Array(workerSlots).fill(null) : null;
        this.queued = 0;
        this.showSimplify = showSimplify;
        this.frame = 0;
        this.startedAt = Date.now();
        this.active = true;
        this.hideCursor();
        this.render();
        if (this.tty) {
            this.timer = setInterval(() => this.render(), 200);
            this.timer.unref();
        }
    }

    setDecompiling(name: string | null): void {
        if (!this.active) return;
        this.decompiling = name;
        // Clearing is painted by the simplify update that follows in the same turn,
        // so the panel does not flash an empty decompile row in between.
        if (name !== null) this.render();
    }

    /** `slot < 0` is the serial in-process simplify; otherwise a worker index. */
    setWorker(slot: number, name: string | null): void {
        if (!this.active) return;
        if (slot < 0) this.simplify = name;
        else if (this.workers && slot < this.workers.length) this.workers[slot] = name;
        // Clearing is painted by markDone, which follows in the same turn.
        if (name !== null) this.render();
    }

    /** ASTs built and waiting for a free simplify worker. */
    setQueued(queued: number): void {
        if (!this.active) return;
        const next = Math.max(0, queued);
        if (this.queued === next) return;
        this.queued = next;
        this.render();
    }

    markDone(): void {
        if (!this.active) return;
        if (this.done < this.total) this.done++;
        this.render();
    }

    /** A warning. Above the live panel so the redraw does not eat it. */
    note(message: string): void {
        const line = message.endsWith("\n") ? message : message + "\n";
        if (!this.active || !this.tty) {
            this.stream.write(line);
            return;
        }
        this.clear();
        this.stream.write(line);
        this.render();
    }

    finish(summary: string): void {
        if (!this.enabled) return;
        const elapsed = this.startedAt === 0 ? "" : `  ${formatElapsed(Date.now() - this.startedAt)}`;
        this.stopTimer();
        if (this.drawn > 0) this.clear();
        this.restoreCursor();
        this.active = false;
        this.startedAt = 0;
        const mark = this.tty ? "\x1b[32m✓\x1b[0m " : "";
        this.stream.write(mark + summary + elapsed + "\n");
    }

    private snapshot(): ProgressSnapshot {
        const columns = this.stream.columns && this.stream.columns > 20 ? this.stream.columns - 1 : 80;
        return {
            title: this.title,
            total: this.total,
            done: this.done,
            elapsedMs: this.startedAt === 0 ? 0 : Date.now() - this.startedAt,
            decompiling: this.decompiling,
            simplify: this.simplify,
            workers: this.workers,
            queued: this.queued,
            showSimplify: this.showSimplify,
            columns,
            color: this.color,
            spinner: this.frame,
        };
    }

    private render(): void {
        if (!this.active || !this.tty) return;
        const snap = this.snapshot();
        const lines = renderProgress(snap);
        this.frame = (this.frame + 1) % SPINNER.length;
        const width = snap.columns;
        let out = this.drawn > 0 ? `\x1b[${this.drawn}A` : "";
        for (const line of lines) out += `\x1b[2K${clipVisible(line, width)}\n`;
        const extra = this.drawn - lines.length;
        for (let i = 0; i < extra; i++) out += "\x1b[2K\n";
        if (extra > 0) out += `\x1b[${extra}A`;
        this.stream.write(out);
        this.drawn = lines.length;
    }

    private clear(): void {
        if (this.drawn === 0) return;
        this.stream.write(`\x1b[${this.drawn}A` + "\x1b[2K\n".repeat(this.drawn) + `\x1b[${this.drawn}A`);
        this.drawn = 0;
    }

    private hideCursor(): void {
        if (!this.tty || this.cursorHidden) return;
        this.stream.write("\x1b[?25l");
        this.cursorHidden = true;
    }

    private restoreCursor(): void {
        if (!this.cursorHidden) return;
        this.stream.write("\x1b[?25h");
        this.cursorHidden = false;
    }

    private stopTimer(): void {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }
}
