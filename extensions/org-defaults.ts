/**
 * Org baseline extension.
 *
 * This is a starting template — replace the body with real org policy
 * (e.g. permission gates, protected paths, default provider/model, custom
 * commands). See the 79 official examples for patterns:
 *   https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions
 *
 * Pi loads every `.ts`/`.js` file under the package `extensions/` dir and
 * calls the default export with the ExtensionAPI. Full API surface:
 *   https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
 */
export default function orgDefaults(pi: any) {
  // Example: register an org-standard slash command.
  // Signature is registerCommand(name, options) — name is a separate string
  // arg, and the callback is `handler(args, ctx)`.
  pi.registerCommand("org-info", {
    description: "Show which org standard package version is loaded",
    handler: async (_args: any, ctx: any) => {
      ctx.ui.notify(
        "Loaded @yourorg/pi-standard. Propose changes via PR to yourorg/pi-standard.",
        "info",
      );
    },
  });

  // Example: block a destructive command at the tool-call boundary.
  // The `tool_call` event is blockable — return { block: true } to veto.
  // Bash args live on event.input.command; guard on event.toolName.
  pi.on("tool_call", (event: any) => {
    if (event?.toolName !== "bash") return;
    const cmd = event?.input?.command ?? "";
    if (/\brm\s+-rf\s+\/(?:\s|$)/.test(cmd)) {
      return { block: true, reason: "Blocked by org standard: refusing `rm -rf /`." };
    }
  });
}
