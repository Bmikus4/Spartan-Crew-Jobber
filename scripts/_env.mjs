// Tiny dependency-free helpers shared by the standalone scripts.
// Next.js auto-loads .env.local for the app; plain `node` does not, so we parse
// it ourselves. Keeps the scripts runnable with just `node scripts/x.mjs`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/** Load KEY=VALUE lines from .env.local into process.env (does not override). */
export function loadEnv() {
  try {
    const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let [, k, v] = m;
      v = v.replace(/^["']|["']$/g, ""); // strip surrounding quotes
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* no .env.local — rely on real env */
  }
}

export function requireEnv(name) {
  const v = (process.env[name] || "").trim();
  if (!v) {
    console.error(
      `\nMISSING ENV: ${name}\n` +
        `Set it in .env.local or the shell before running this script.\n`
    );
    process.exit(2);
  }
  return v;
}

/** OnSinch base URL (defaults to the Spartan production tenant). */
export function onsinchBase() {
  return (
    process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1"
  ).replace(/\/$/, "");
}

/**
 * GET a list endpoint. `apikey ` prefix is mandatory (NOT Bearer).
 * Returns the parsed JSON body ({ data, pagination }).
 */
export async function onsinchGet(path, key) {
  const res = await fetch(onsinchBase() + path, {
    headers: { Authorization: `apikey ${key}`, "Content-Type": "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

export const ROOT_DIR = ROOT;
