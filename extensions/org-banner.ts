/**
 * Org banner extension.
 *
 * Renders the company ASCII-art banner at the very top of the terminal, above
 * pi's startup output (skills, extensions, warnings). The art is colorized by
 * piping it through `awk`, which wraps every line in ANSI escapes to form a
 * vertical brand gradient. Two color depths are supported: 24-bit truecolor
 * (smooth per-line RGB interpolation) and basic 16-color ANSI (a short ramp of
 * standard SGR codes) for terminals that don't advertise truecolor. The palette
 * is also chosen to match the terminal theme (light vs. dark) so the banner
 * stays legible on either background. Set NO_COLOR to disable coloring.
 *
 * Placement note: pi's startup log and scrollback widgets all render after the
 * extension factory runs, so the only hook that lands *above* that output is
 * the factory body itself. We therefore write the banner straight to stdout
 * during load, before registering anything. This is deliberately ahead of the
 * documented UI APIs (setWidget/appendEntry), which can only draw below the
 * startup log.
 */
import { spawnSync } from "node:child_process";

// --- Brand palette -----------------------------------------------------------
// Edit these to re-theme the banner org-wide.
//
// `truecolor`: RGB triples, gradient top→bottom, one pair per terminal mode.
//   Dark-terminal shades (brighter) and light-terminal shades (deeper for contrast).
// `ans16`: standard SGR foreground codes used top→bottom on terminals without
//   truecolor. awk cycles through the ramp across the banner's rows. 90-97 are
//   the "bright" set (good on dark bg); 34/94/36/96 lean blue/cyan to echo the
//   violet→sky truecolor gradient. 30-37 are the normal set (better on light bg).
const BRAND = {
  dark: { from: [124, 92, 255], to: [56, 189, 248] }, // violet → sky
  light: { from: [79, 46, 209], to: [2, 132, 199] }, // deeper violet → deeper sky
};
const ANSI16 = {
  dark: [35, 95, 94, 34, 96, 36], // magenta → bright blue → bright cyan → cyan
  light: [35, 34, 34, 36, 36, 36], // magenta → blue → cyan (no bright, for light bg)
};

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
// Truecolor: wrap each line in a 24-bit gradient interpolated between `from`
// (top) and `to` (bottom). Passed endpoint RGB and total line count as -v vars.
const AWK_TRUECOLOR = String.raw`
BEGIN { esc = sprintf("%c", 27) }
{
  # t in [0,1] down the block; guard single-line banners.
  t = (n > 1) ? (NR - 1) / (n - 1) : 0
  r = int(fr + (tr - fr) * t + 0.5)
  g = int(fg + (tg - fg) * t + 0.5)
  b = int(fb + (tb - fb) * t + 0.5)
  printf "%s[38;2;%d;%d;%dm%s%s[0m\n", esc, r, g, b, $0, esc
}
`;

// 16-color: pick a standard SGR foreground code per row from the `codes` ramp
// (space-separated, passed as -v codes). Rows are mapped evenly across the
// ramp so the gradient direction is preserved regardless of banner height.
const AWK_ANSI16 = String.raw`
BEGIN { esc = sprintf("%c", 27); m = split(codes, ramp, " ") }
{
  t = (n > 1) ? (NR - 1) / (n - 1) : 0
  idx = int(t * (m - 1) + 0.5) + 1
  printf "%s[%dm%s%s[0m\n", esc, ramp[idx], $0, esc
}
`;

function detectMode(): "light" | "dark" {
  // COLORFGBG is "fg;bg"; a high bg index (7/15) indicates a light terminal.
  const cfb = process.env.COLORFGBG;
  if (cfb) {
    const bg = Number(cfb.split(";").pop());
    if (Number.isFinite(bg) && bg >= 11) return "light";
  }
  return "dark";
}

/**
 * Decide the color depth to emit:
 *   "none"      - NO_COLOR set, or a dumb/no-color terminal → no escapes.
 *   "truecolor" - terminal advertises 24-bit color.
 *   "ansi16"    - everything else that can show color.
 */
function detectDepth(): "none" | "truecolor" | "ansi16" {
  if (process.env.NO_COLOR !== undefined) return "none";
  const term = process.env.TERM ?? "";
  if (term === "dumb" || term === "") return "none";
  const ct = (process.env.COLORTERM ?? "").toLowerCase();
  if (ct === "truecolor" || ct === "24bit") return "truecolor";
  // 256-color terminals still render truecolor escapes correctly in practice,
  // but to be safe we only claim truecolor when COLORTERM says so; otherwise 16.
  return "ansi16";
}

/**
 * Pipe the banner through awk synchronously and return the ANSI-colored text.
 * Synchronous so it completes before pi emits any startup output. Falls back to
 * the uncolored art if awk is unavailable or errors.
 */
function colorize(
  depth: "none" | "truecolor" | "ansi16",
  mode: "light" | "dark",
  lineCount: number,
): string {
  if (depth === "none") return BANNER;

  let args: string[];
  if (depth === "truecolor") {
    const pal = BRAND[mode];
    args = [
      "-v", `n=${lineCount}`,
      "-v", `fr=${pal.from[0]}`, "-v", `fg=${pal.from[1]}`, "-v", `fb=${pal.from[2]}`,
      "-v", `tr=${pal.to[0]}`, "-v", `tg=${pal.to[1]}`, "-v", `tb=${pal.to[2]}`,
      AWK_TRUECOLOR,
    ];
  } else {
    args = [
      "-v", `n=${lineCount}`,
      "-v", `codes=${ANSI16[mode].join(" ")}`,
      AWK_ANSI16,
    ];
  }

  const res = spawnSync("awk", args, { input: BANNER, encoding: "utf8" });
  if (res.status === 0 && res.stdout) return res.stdout.replace(/\n$/, "");
  return BANNER;
}

export default function orgBanner(_pi: any) {
  // Only draw for an interactive terminal; skip pipes, print/JSON modes, dumb terms.
  if (!process.stdout.isTTY) return;

  const lineCount = BANNER.split("\n").length;
  // Blank line above and below so the banner isn't flush against the prompt
  // or pi's first startup line.
  process.stdout.write("\n" + colorize(detectDepth(), detectMode(), lineCount) + "\n\n");
}
