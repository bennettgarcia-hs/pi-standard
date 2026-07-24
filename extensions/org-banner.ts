/**
 * Org banner extension.
 *
 * Renders the company ASCII-art banner at the very top of the terminal, above
 * pi's startup output (skills, extensions, warnings). The banner is colorized
 * with a vertical gradient built from the USER'S OWN terminal palette — never a
 * hardcoded brand color.
 *
 * How the colors are sourced (in order of preference):
 *   1. truecolor  — query the terminal for the real RGB of a few palette slots
 *                   via OSC 4 ("\e]4;N;?"), then interpolate a smooth 24-bit
 *                   gradient between those actual values. This is the user's
 *                   exact palette, rendered as a gradient.
 *   2. ansi16     — if the OSC query fails/times out (some terminals or
 *                   multiplexers don't answer), emit standard SGR foreground
 *                   codes (\e[35m etc.). These ALSO resolve to the user's
 *                   palette — \e[35m is whatever the user themed "magenta" to —
 *                   just without smooth interpolation.
 *   3. none       — NO_COLOR set, or a dumb/no-TTY terminal → plain art.
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

// --- Gradient stops ----------------------------------------------------------
// Palette slots (ANSI color indices) sampled top→bottom to build the gradient.
// We read the REAL RGB of these slots from the terminal, so the banner uses the
// user's actual theme. 5/4/6 = magenta → blue → cyan, a cool sweep that echoes
// the logo. The same indices double as the 16-color SGR ramp (35/34/36) so the
// ansi16 fallback pulls from the same palette slots.
const STOP_INDICES = [5, 4, 6]; // magenta, blue, cyan
const SGR_FOR_INDEX: Record<number, number> = { 4: 34, 5: 35, 6: 36 };

// --- Banner art --------------------------------------------------------------
// Self-contained copy of the org banner. To update: replace these lines
// (keep them raw — coloring is applied at render time by the awk pass below).
const BANNER = String.raw`
██  ██
██░ ██░ ██  ██  █████    ████   ██ ██         ███████
██████░ ██░ ██░ ██░░██  ██░░██  ███ ░░  ████   ██░██░░
██░░██░  █████░ █████░░ █████░░ ██░░     ░░░░ ██░░██░
██░ ██░   ░░██░ ██░░░░   ████░  ██░           ██░████
 ░░  ░░ ████ ░░ ██░       ░░░░   ░░            ░░ ░░░░
         ░░░░    ░░
`.replace(/^\n/, "").replace(/\n$/, "");

// --- awk palette programs ----------------------------------------------------
// Truecolor: interpolate a 24-bit gradient across an arbitrary list of RGB
// `stops` (space-separated "r,g,b" triples). Each row maps to a point along the
// multi-segment gradient, so any number of stops works.
const AWK_TRUECOLOR = String.raw`
BEGIN { esc = sprintf("%c", 27); m = split(stops, S, " ") }
{
  # t in [0,1] down the block; guard single-line banners.
  t = (n > 1) ? (NR - 1) / (n - 1) : 0
  seg = t * (m - 1)          # position along the stop list
  i = int(seg)               # lower stop index (0-based)
  if (i > m - 2) i = m - 2
  if (i < 0) i = 0
  f = seg - i                # fraction into this segment
  split(S[i + 1], lo, ",")
  split(S[i + 2], hi, ",")
  r = int(lo[1] + (hi[1] - lo[1]) * f + 0.5)
  g = int(lo[2] + (hi[2] - lo[2]) * f + 0.5)
  b = int(lo[3] + (hi[3] - lo[3]) * f + 0.5)
  printf "%s[38;2;%d;%d;%dm%s%s[0m\n", esc, r, g, b, $0, esc
}
`;

// 16-color: pick a standard SGR foreground code per row from the `codes` ramp
// (space-separated). Rows map evenly across the ramp so the gradient direction
// is preserved regardless of banner height. These codes resolve to the user's
// own palette.
const AWK_ANSI16 = String.raw`
BEGIN { esc = sprintf("%c", 27); m = split(codes, ramp, " ") }
{
  t = (n > 1) ? (NR - 1) / (n - 1) : 0
  idx = int(t * (m - 1) + 0.5) + 1
  printf "%s[%dm%s%s[0m\n", esc, ramp[idx], $0, esc
}
`;

type RGB = [number, number, number];

/**
 * Query the terminal for the real RGB of the given palette indices using OSC 4.
 * Returns a map of index → [r,g,b] (0-255), or null if the terminal doesn't
 * answer (no TTY, multiplexer swallows it, timeout, etc.).
 *
 * Uses an independent /dev/tty fd so we don't fight pi's stdin handling, and
 * `stty` (acting on that fd) to enter a non-canonical, no-echo read mode so the
 * escape-sequence reply isn't line-buffered or echoed. Everything is wrapped in
 * try/finally to restore the terminal even on error.
 */
function queryPalette(indices: number[]): Map<number, RGB> | null {
  let fd: number | null = null;
  let saved: string | null = null;
  try {
    fd = openSync("/dev/tty", "r+");

    // Save current terminal settings, then switch to raw-ish read with a short
    // inter-byte timeout (time is in tenths of a second). stty acts on its
    // stdin, which we point at the tty fd — portable across macOS and Linux.
    const g = spawnSync("stty", ["-g"], { stdio: [fd, "pipe", "ignore"], encoding: "utf8" });
    if (g.status === 0 && g.stdout) saved = g.stdout.trim();
    spawnSync("stty", ["-echo", "-icanon", "min", "0", "time", "2"], {
      stdio: [fd, "ignore", "ignore"],
    });

    // Fire all queries at once, then read until we've parsed them all or the
    // overall deadline passes.
    const query = indices.map((i) => `\x1b]4;${i};?\x07`).join("");
    writeSync(fd, query);

    const buf = Buffer.alloc(4096);
    let acc = "";
    const deadline = Date.now() + 400; // ms; generous but bounded
    const result = new Map<number, RGB>();
    // OSC 4 reply: ESC ] 4 ; N ; rgb:RRRR/GGGG/BBBB (BEL or ST terminated)
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
          const idx = Number(m[1]);
          result.set(idx, [scale(m[2]), scale(m[3]), scale(m[4])]);
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

/** Run the banner through an awk program synchronously; plain art on failure. */
function runAwk(program: string, extraArgs: string[]): string {
  const res = spawnSync("awk", ["-v", `n=${BANNER.split("\n").length}`, ...extraArgs, program], {
    input: BANNER,
    encoding: "utf8",
  });
  if (res.status === 0 && res.stdout) return res.stdout.replace(/\n$/, "");
  return BANNER;
}

/** Build the colored banner, sourcing colors from the user's real palette. */
function colorize(): string {
  if (noColor()) return BANNER;

  // Preferred: real palette RGB → smooth truecolor gradient.
  if (supportsTruecolor()) {
    const palette = queryPalette(STOP_INDICES);
    if (palette) {
      const stops = STOP_INDICES.filter((i) => palette.has(i)).map((i) => palette.get(i)!.join(","));
      if (stops.length >= 2) return runAwk(AWK_TRUECOLOR, ["-v", `stops=${stops.join(" ")}`]);
    }
    // Truecolor terminal but the query gave us nothing usable: fall through to
    // the 16-color path, which still resolves to the user's palette.
  }

  // Fallback: SGR codes → the user's palette, no interpolation.
  const codes = STOP_INDICES.map((i) => SGR_FOR_INDEX[i]).join(" ");
  return runAwk(AWK_ANSI16, ["-v", `codes=${codes}`]);
}

export default function orgBanner(_pi: any) {
  // Only draw for an interactive terminal; skip pipes, print/JSON modes.
  if (!process.stdout.isTTY) return;

  // Blank line above and below so the banner isn't flush against the prompt
  // or pi's first startup line.
  process.stdout.write("\n" + colorize() + "\n\n");
}
