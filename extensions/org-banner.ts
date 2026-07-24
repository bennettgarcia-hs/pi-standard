/**
 * Org banner extension.
 *
 * Renders the company ASCII-art banner above the editor at the start of each
 * new chat. The art is colorized by piping it through `awk`, which wraps every
 * line in ANSI truecolor escapes to form a vertical brand gradient. The palette
 * is chosen to match the terminal theme (light vs. dark) so the banner stays
 * legible on either background.
 *
 * API used (see docs/extensions.md):
 *   - pi.on("session_start", (event, ctx) => ...)   event.reason: "startup" | "new" | ...
 *   - ctx.ui.setWidget(key, string[])               multi-line widget above the editor; lines may contain ANSI
 */
import { spawn } from "node:child_process";

// --- Brand palette -----------------------------------------------------------
// Edit these to re-theme the banner org-wide. RGB triples, gradient top→bottom.
// Dark-terminal shades (brighter) and light-terminal shades (deeper for contrast).
const BRAND = {
  dark: { from: [124, 92, 255], to: [56, 189, 248] }, // violet → sky
  light: { from: [79, 46, 209], to: [2, 132, 199] }, // deeper violet → deeper sky
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

// --- awk palette program -----------------------------------------------------
// Reads the banner on stdin and emits each line wrapped in an ANSI truecolor
// gradient interpolated between `from` (top) and `to` (bottom). Passed the
// endpoint RGB and total line count as -v variables.
const AWK_PROGRAM = String.raw`
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

function detectMode(): "light" | "dark" {
  // COLORFGBG is "fg;bg"; a high bg index (7/15) indicates a light terminal.
  const cfb = process.env.COLORFGBG;
  if (cfb) {
    const bg = Number(cfb.split(";").pop());
    if (Number.isFinite(bg) && bg >= 11) return "light";
  }
  return "dark";
}

/** Pipe the banner through awk and return the ANSI-colored lines. */
function colorize(mode: "light" | "dark", lineCount: number): Promise<string[]> {
  const pal = BRAND[mode];
  return new Promise((resolve) => {
    const args = [
      "-v", `n=${lineCount}`,
      "-v", `fr=${pal.from[0]}`, "-v", `fg=${pal.from[1]}`, "-v", `fb=${pal.from[2]}`,
      "-v", `tr=${pal.to[0]}`, "-v", `tg=${pal.to[1]}`, "-v", `tb=${pal.to[2]}`,
      AWK_PROGRAM,
    ];
    const child = spawn("awk", args, { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    // Fall back to the uncolored art if awk is unavailable or errors.
    child.on("error", () => resolve(BANNER.split("\n")));
    child.on("close", (code) => {
      if (code === 0 && out) resolve(out.replace(/\n$/, "").split("\n"));
      else resolve(BANNER.split("\n"));
    });
    child.stdin.write(BANNER);
    child.stdin.end();
  });
}

export default function orgBanner(pi: any) {
  pi.on("session_start", async (event: any, ctx: any) => {
    // Only greet on a fresh launch or a new chat — not on reload/resume/fork.
    if (event?.reason !== "startup" && event?.reason !== "new") return;
    if (!ctx?.ui?.hasUI) return; // no-op in print/JSON modes

    const lines = BANNER.split("\n");
    const colored = await colorize(detectMode(), lines.length);
    ctx.ui.setWidget("org-banner", colored);
  });
}
