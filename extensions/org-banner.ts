/**
 * Org banner extension.
 *
 * Renders the company ASCII-art banner ("Hyper-π") at the very top of the
 * terminal, above pi's startup output (skills, extensions, warnings). Each
 * LETTER of the logo is painted a single color drawn from the USER'S OWN
 * terminal palette — never a hardcoded brand color, and no top-to-bottom
 * gradient (which muddied through gray between distant hues).
 *
 * How the colors are sourced (in order of preference):
 *   1. truecolor  — query the terminal for the real RGB of a set of palette
 *                   slots via OSC 4 ("\e]4;N;?"), and emit 24-bit escapes with
 *                   those exact values. This is the user's literal palette.
 *   2. ansi16     — if the OSC query fails/times out (some terminals or
 *                   multiplexers don't answer), emit standard SGR foreground
 *                   codes (\e[35m etc.), which ALSO resolve to the user's
 *                   palette, just limited to the 16 named slots.
 *   3. none       — NO_COLOR set, or a dumb/no-TTY terminal → plain art.
 *
 * Why Node and not awk: macOS's /usr/bin/awk is byte-oriented and corrupts the
 * multibyte box-drawing glyphs (█ ░) when indexing columns, so per-letter
 * coloring can't be done portably in awk. Node handles Unicode natively.
 *
 * Placement note: pi's startup log and scrollback widgets all render after the
 * extension factory runs, so the only hook that lands *above* that output is
 * the factory body itself. We therefore write the banner straight to stdout
 * during load, before registering anything. This is deliberately ahead of the
 * documented UI APIs (setWidget/appendEntry), which can only draw below the
 * startup log.
 */
import { spawnSync } from "node:child_process";
import { openSync, readSync, writeSync, closeSync } from "node:fs";

// --- Per-letter palette assignment -------------------------------------------
// The logo has 7 glyphs: H y p e r - π. Each is assigned one palette slot
// (ANSI color index). We read the slot's REAL RGB from the terminal, so the
// banner uses the user's actual theme. Indices chosen for a lively, legible
// spread across a typical 16-color scheme; edit to re-theme org-wide.
//   9=bright red 11=bright yellow 10=bright green 14=bright cyan
//   12=bright blue 13=bright magenta
const LETTER_SLOTS = [13, 12, 14, 10, 11, 9, 13]; // H y p e r - π
// SGR foreground code for each palette index (bright set = 90+(idx-8)).
const sgrForIndex = (idx: number): number => (idx >= 8 ? 90 + (idx - 8) : 30 + idx);

// --- Banner art --------------------------------------------------------------
// Self-contained copy of the org banner. To update: replace these lines. The
// glyph boundaries are detected at runtime from the solid (█) blocks, so new
// art re-segments automatically as long as letters are separated by >=2
// shadow/space columns.
const BANNER = String.raw`
██  ██
██░ ██░ ██  ██  █████    ████   ██ ██         ███████
██████░ ██░ ██░ ██░░██  ██░░██  ███ ░░  ████   ██░██░░
██░░██░  █████░ █████░░ █████░░ ██░░     ░░░░ ██░░██░
██░ ██░   ░░██░ ██░░░░   ████░  ██░           ██░████
 ░░  ░░ ████ ░░ ██░       ░░░░   ░░            ░░ ░░░░
         ░░░░    ░░
`.replace(/^\n/, "").replace(/\n$/, "");

type RGB = [number, number, number];

/**
 * Segment the banner into glyph columns from the solid (█) blocks. Returns, for
 * each column index, the glyph number it belongs to. Runs of solid cells are
 * treated as one glyph; a gap of >=2 non-solid columns separates glyphs. The
 * cut between two glyphs is the midpoint of the gap, so shadow/space cells are
 * attributed to whichever letter they sit closest to.
 */
function columnToGlyph(): { map: number[]; glyphCount: number; width: number } {
  const rows = BANNER.split("\n").map((l) => [...l]);
  const width = Math.max(...rows.map((r) => r.length));
  const solid = new Array(width).fill(false);
  for (const r of rows) {
    for (let i = 0; i < r.length; i++) if (r[i] === "█") solid[i] = true;
  }
  const runs: Array<[number, number]> = [];
  let inRun = false, start = 0, last = 0;
  for (let i = 0; i < width; i++) {
    if (solid[i]) {
      if (!inRun) { start = i; inRun = true; }
      last = i;
    } else if (inRun) {
      let gap = 0, j = i;
      while (j < width && !solid[j]) { gap++; j++; }
      if (gap >= 2 || j >= width) { runs.push([start, last]); inRun = false; }
    }
  }
  if (inRun) runs.push([start, last]);

  const cuts: number[] = [];
  for (let k = 0; k < runs.length - 1; k++) {
    cuts.push(Math.floor((runs[k][1] + runs[k + 1][0]) / 2));
  }
  const map = new Array(width);
  for (let c = 0; c < width; c++) {
    let g = 0;
    for (const cut of cuts) if (c > cut) g++;
    map[c] = g;
  }
  return { map, glyphCount: runs.length, width };
}

/**
 * Query the terminal for the real RGB of the given palette indices using OSC 4.
 * Returns a map of index → [r,g,b] (0-255), or null if the terminal doesn't
 * answer (no TTY, multiplexer swallows it, timeout, etc.).
 *
 * Uses an independent /dev/tty fd and `stty` (acting on that fd) to enter a
 * non-canonical, no-echo read mode so the escape-sequence reply isn't
 * line-buffered or echoed. Everything is wrapped in try/finally to restore the
 * terminal even on error.
 */
function queryPalette(indices: number[]): Map<number, RGB> | null {
  let fd: number | null = null;
  let saved: string | null = null;
  try {
    fd = openSync("/dev/tty", "r+");
    const g = spawnSync("stty", ["-g"], { stdio: [fd, "pipe", "ignore"], encoding: "utf8" });
    if (g.status === 0 && g.stdout) saved = g.stdout.trim();
    spawnSync("stty", ["-echo", "-icanon", "min", "0", "time", "2"], {
      stdio: [fd, "ignore", "ignore"],
    });

    const query = indices.map((i) => `\x1b]4;${i};?\x07`).join("");
    writeSync(fd, query);

    const buf = Buffer.alloc(4096);
    let acc = "";
    const deadline = Date.now() + 400; // ms; bounded
    const result = new Map<number, RGB>();
    const re = /\]4;(\d+);rgb:([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)/g;

    while (Date.now() < deadline && result.size < indices.length) {
      let bytes = 0;
      try {
        bytes = readSync(fd, buf, 0, buf.length, null);
      } catch {
        bytes = 0; // EAGAIN / no data yet
      }
      if (bytes > 0) {
        acc += buf.toString("latin1", 0, bytes);
        let m: RegExpExecArray | null;
        re.lastIndex = 0;
        while ((m = re.exec(acc)) !== null) {
          result.set(Number(m[1]), [scale(m[2]), scale(m[3]), scale(m[4])]);
        }
      }
    }
    return result.size > 0 ? result : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        if (saved) spawnSync("stty", [saved], { stdio: [fd, "ignore", "ignore"] });
        else spawnSync("stty", ["sane"], { stdio: [fd, "ignore", "ignore"] });
      } catch {
        /* best effort */
      }
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Scale a variable-width hex color component (e.g. "ffff" or "ff") to 0-255. */
function scale(hex: string): number {
  const max = Math.pow(16, hex.length) - 1;
  return Math.round((parseInt(hex, 16) / max) * 255);
}

function noColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return true;
  const term = process.env.TERM ?? "";
  return term === "dumb" || term === "";
}

function supportsTruecolor(): boolean {
  const ct = (process.env.COLORTERM ?? "").toLowerCase();
  return ct === "truecolor" || ct === "24bit";
}

const ESC = "\x1b";
const RESET = `${ESC}[0m`;

/**
 * Build the colored banner. Each glyph is one solid palette color; a color
 * change is only emitted at glyph boundaries (not every cell) to keep the
 * escape overhead low and the look clean.
 */
function colorize(): string {
  if (noColor()) return BANNER;

  const { map, glyphCount } = columnToGlyph();

  // Resolve one SGR-code-or-RGB per glyph from the user's palette.
  const wanted = LETTER_SLOTS.slice(0, glyphCount);
  let rgbBySlot: Map<number, RGB> | null = null;
  if (supportsTruecolor()) rgbBySlot = queryPalette([...new Set(wanted)]);

  const open = (glyph: number): string => {
    const slot = LETTER_SLOTS[glyph % LETTER_SLOTS.length];
    const rgb = rgbBySlot?.get(slot);
    if (rgb) return `${ESC}[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
    return `${ESC}[${sgrForIndex(slot)}m`; // palette fallback (still user's colors)
  };

  return BANNER.split("\n")
    .map((line) => {
      const cells = [...line];
      let out = "";
      let cur = -1;
      for (let c = 0; c < cells.length; c++) {
        const glyph = map[c] ?? 0;
        if (glyph !== cur) {
          out += open(glyph);
          cur = glyph;
        }
        out += cells[c];
      }
      return out + RESET;
    })
    .join("\n");
}

// Process-level guard: pi may load this package more than once (e.g. a global
// install plus a `pi -e <path>` dev copy). Each loaded copy runs the factory,
// which would print the banner once per copy. This flag ensures a single print
// per process regardless of how many copies are loaded.
const GUARD = "__ORG_BANNER_PRINTED__";

export default function orgBanner(_pi: any) {
  // Only draw for an interactive terminal; skip pipes, print/JSON modes.
  if (!process.stdout.isTTY) return;
  if ((globalThis as any)[GUARD]) return;
  (globalThis as any)[GUARD] = true;

  // Blank line above and below so the banner isn't flush against the prompt
  // or pi's first startup line.
  process.stdout.write("\n" + colorize() + "\n\n");
}
