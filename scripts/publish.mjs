// Uploads a zip of every mod version the "mods" release doesn't have yet,
// then builds the Pages site in _site/: the page, index.json (every mod with
// its download count) and mods/<id>/mod.json + preview, which installed
// copies check for updates. Needs REPO and GH_TOKEN (for gh). LOCAL=1 skips
// GitHub and makes up counts, to preview the site.

import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MODS_DIR, RELEASE_TAG, VERSION_RE, assetName, checkMod, modIds, readOwners, storeURLs } from "./lib.mjs";

const { REPO = "", LOCAL } = process.env;
const SITE = "_site";
const DIST = "dist";

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });
const gh = (...args) => run("gh", args);

// Asset name -> download count, creating the release the first time.
function releaseAssets() {
  let releaseId;
  try {
    releaseId = gh("api", `repos/${REPO}/releases/tags/${RELEASE_TAG}`, "--jq", ".id").trim();
  } catch {
    gh("release", "create", RELEASE_TAG, "--repo", REPO, "--title", "Mod downloads", "--latest=false",
      "--notes", "Every version of every mod, built from mods/. Install them from the store page.");
    return new Map();
  }
  const lines = gh("api", "--paginate", `repos/${REPO}/releases/${releaseId}/assets?per_page=100`,
    "--jq", ".[] | [.name, .download_count] | @tsv");
  return new Map(lines.split("\n").filter(Boolean).map(l => l.split("\t")).map(([n, c]) => [n, Number(c)]));
}

// "<id>-<version>.zip" -> id (versions have no "-").
function idOf(name) {
  const m = /^(.+)-([^-]+)\.zip$/.exec(name);
  return m && VERSION_RE.test(m[2]) ? m[1] : null;
}

function dates(id) {
  try {
    const log = run("git", ["log", "--format=%cI", "--", `${MODS_DIR}/${id}`]).trim().split("\n");
    return { updated: log[0] || null, added: log.at(-1) || null };
  } catch {
    return { updated: null, added: null };
  }
}

const assets = LOCAL ? new Map() : releaseAssets();
const owners = await readOwners();
await rm(SITE, { recursive: true, force: true });
await rm(DIST, { recursive: true, force: true });
await cp("site", SITE, { recursive: true });
await mkdir(DIST);

const list = [];
for (const id of await modIds()) {
  const dir = join(MODS_DIR, id);
  const { manifest, errors, hasScript, hasContentStyles, preview } = await checkMod(dir, id);
  if (errors.length) {
    console.log(`::warning::Skipping ${id}: ${errors.join(" ")}`);
    continue;
  }
  const asset = assetName(id, manifest.version);
  if (!LOCAL && !assets.has(asset)) {
    // Same layout as the Library's Export…: one folder named after the id.
    run("zip", ["-r", "-X", "-q", join("..", DIST, asset), id], { cwd: MODS_DIR });
    gh("release", "upload", RELEASE_TAG, join(DIST, asset), "--repo", REPO);
    assets.set(asset, 0);
    console.log(`Uploaded ${asset}`);
  }

  await mkdir(join(SITE, MODS_DIR, id), { recursive: true });
  await cp(join(dir, "mod.json"), join(SITE, MODS_DIR, id, "mod.json"));
  if (preview) {
    await cp(join(dir, preview), join(SITE, MODS_DIR, id, preview.split("/").pop()));
  }
  list.push({
    id,
    name: manifest.name.trim(),
    version: manifest.version,
    author: (manifest.author || owners[id]?.[0] || "").trim(),
    description: (manifest.description || "").trim(),
    homepage: manifest.homepage || null,
    script: hasScript,
    contentStyles: !!hasContentStyles,
    options: Array.isArray(manifest.options) ? manifest.options.length : 0,
    preview: preview ? `${MODS_DIR}/${id}/${preview.split("/").pop()}` : null,
    download: storeURLs(REPO || "owner/repo", id, manifest.version).downloadURL,
    source: `https://github.com/${REPO}/tree/main/${MODS_DIR}/${id}`,
    owners: owners[id] ?? [],
    downloads: 0,
    ...dates(id),
  });
}

// Counts add up every version ever uploaded, so updates don't reset them.
const byId = new Map(list.map(m => [m.id, m]));
for (const [name, count] of assets) {
  const mod = byId.get(idOf(name));
  if (mod) {
    mod.downloads += count;
  }
}
if (LOCAL) {
  for (const mod of list) {
    mod.downloads = Math.floor(Math.random() * 5000);
  }
}

await writeFile(join(SITE, "index.json"), JSON.stringify({ repo: REPO, generated: new Date().toISOString(), mods: list }));
await writeFile(join(SITE, ".nojekyll"), "");
console.log(`Listed ${list.length} mod(s).`);
