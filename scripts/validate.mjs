#!/usr/bin/env node
/**
 * Pre-merge validator for the org Pi standard package.
 *
 * Checks (no external deps — runs on plain Node):
 *   1. package.json parses and declares the `pi-package` keyword + `pi` manifest.
 *   2. Every skills/<dir>/SKILL.md has valid frontmatter:
 *      - `name`: required, <=64 chars, lowercase letters/digits/hyphens.
 *      - `description`: required, <=1024 chars.
 *   3. Every themes/*.json parses as JSON.
 *
 * Extension type/lint checks are left to `tsc`/`eslint` in CI (see workflow),
 * since this script intentionally has zero dependencies.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const fail = (m) => errors.push(m);

// 1. package.json
try {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes("pi-package")) {
    fail('package.json: "keywords" must include "pi-package".');
  }
  if (!pkg.pi || typeof pkg.pi !== "object") {
    fail('package.json: missing "pi" manifest object.');
  }
} catch (e) {
  fail(`package.json: cannot parse (${e.message}).`);
}

// 2. skills
const skillsDir = join(root, "skills");
function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (mm) out[mm[1]] = mm[2].trim();
  }
  return out;
}
function walkSkills(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      walkSkills(p);
    } else if (entry === "SKILL.md") {
      const fm = parseFrontmatter(readFileSync(p, "utf8"));
      const rel = p.slice(root.length + 1);
      if (!fm) { fail(`${rel}: missing YAML frontmatter.`); continue; }
      if (!fm.name) fail(`${rel}: frontmatter missing "name".`);
      else if (!/^[a-z0-9-]{1,64}$/.test(fm.name))
        fail(`${rel}: "name" must be <=64 chars, lowercase/digits/hyphens.`);
      if (!fm.description) fail(`${rel}: frontmatter missing "description".`);
      else if (fm.description.length > 1024)
        fail(`${rel}: "description" exceeds 1024 chars.`);
    }
  }
}
if (existsSync(skillsDir)) walkSkills(skillsDir);

// 3. themes
const themesDir = join(root, "themes");
if (existsSync(themesDir)) {
  for (const entry of readdirSync(themesDir)) {
    if (entry.endsWith(".json")) {
      try { JSON.parse(readFileSync(join(themesDir, entry), "utf8")); }
      catch (e) { fail(`themes/${entry}: invalid JSON (${e.message}).`); }
    }
  }
}

if (errors.length) {
  console.error("Validation FAILED:\n" + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
console.log("Validation passed.");
