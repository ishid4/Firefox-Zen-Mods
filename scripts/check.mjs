// Checks every mod in mods/, for pull requests (submitted or opened by hand).
// With BASE_REF (a git ref), changed mods must also raise their version and
// keep the store's updateURL / downloadURL.

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { MODS_DIR, checkMod, compareVersions, modIds, readOwners, storeURLs } from "./lib.mjs";

const { BASE_REF, REPO = "" } = process.env;

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const atBase = id => {
  try {
    return JSON.parse(git("show", `${BASE_REF}:${MODS_DIR}/${id}/mod.json`));
  } catch {
    return null;
  }
};

const changed = new Set(
  BASE_REF
    ? git("diff", "--name-only", `${BASE_REF}...HEAD`, "--", MODS_DIR)
        .split("\n")
        .filter(Boolean)
        .map(path => path.split("/")[1])
    : [],
);

const owners = await readOwners();
let failed = false;
for (const id of await modIds()) {
  const { manifest, errors, warnings, hasScript } = await checkMod(join(MODS_DIR, id), id);
  if (manifest && REPO) {
    const want = storeURLs(REPO, id, manifest.version);
    for (const key of ["updateURL", "downloadURL"]) {
      if (manifest[key] !== want[key]) {
        errors.push(`"${key}" must be ${want[key]}`);
      }
    }
  }
  if (!owners[id]?.length) {
    errors.push(`No owner in owners.json.`);
  }
  if (changed.has(id) && manifest) {
    const base = atBase(id);
    if (base && compareVersions(manifest.version, base.version ?? "0") <= 0) {
      errors.push(`Changed but still at version ${manifest.version}; raise it.`);
    }
  }
  const tag = changed.has(id) ? " (changed)" : "";
  console.log(`${errors.length ? "✗" : "✓"} ${id}${tag}${hasScript ? " [script]" : ""}`);
  for (const e of errors) {
    console.log(`::error file=${MODS_DIR}/${id}/mod.json::${id}: ${e}`);
  }
  for (const w of warnings) {
    console.log(`::warning file=${MODS_DIR}/${id}/mod.json::${id}: ${w}`);
  }
  failed ||= errors.length > 0;
}
process.exitCode = failed ? 1 : 0;
