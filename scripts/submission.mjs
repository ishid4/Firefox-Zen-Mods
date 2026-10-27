// Turns a "Submit a mod" issue into files under mods/<id>/, ready for a pull
// request. Reads ISSUE_BODY, ISSUE_AUTHOR, ISSUE_NUMBER and REPO from the
// environment; writes comment.md, pr-title.txt and pr-body.md to OUT_DIR and
// ok / id / version to GITHUB_OUTPUT. The issue body is untrusted: nothing
// from it reaches a shell, and only GitHub's own attachment URLs are fetched.

import { execFileSync } from "node:child_process";
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ID_RE, MAX_ZIP, MODS_DIR, checkMod, compareVersions, pagesURL, readOwners, storeURLs,
} from "./lib.mjs";

const { ISSUE_BODY = "", ISSUE_AUTHOR = "", ISSUE_NUMBER = "0", REPO = "", OUT_DIR = ".", GITHUB_OUTPUT } = process.env;

class Rejected extends Error {}

const output = async (key, value) => GITHUB_OUTPUT && appendFile(GITHUB_OUTPUT, `${key}=${value}\n`);
const bullets = list => list.map(s => `- ${s}`).join("\n");

// The "### Mod zip" section of the form, else the whole body.
function zipURL(body) {
  const section = body.split(/^###\s+/m).find(s => /^Mod zip/i.test(s)) ?? body;
  const repoPath = REPO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    String.raw`https://github\.com/(?:user-attachments/files|${repoPath}/files)/\d+/[^\s)\]"'<>]+\.zip`,
    "gi",
  );
  const found = [...new Set(section.match(re) ?? [])];
  if (!found.length) {
    throw new Rejected("No .zip attachment found. Drag the mod's .zip into the **Mod zip** box (Library → Mods → Export… makes one).");
  }
  if (found.length > 1) {
    throw new Rejected("Attach one .zip per submission.");
  }
  return found[0];
}

async function download(url, to) {
  // No token: attachments of a public repository are public.
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Rejected(`Couldn't download the attachment (${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_ZIP) {
    throw new Rejected("The zip is over 20 MB, which Firefox-Zen won't download.");
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Rejected("The attachment isn't a zip file.");
  }
  await writeFile(to, bytes);
}

function unzip(zip, into) {
  let names;
  try {
    names = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    throw new Rejected("The zip couldn't be read.");
  }
  // Windows PowerShell 5's Compress-Archive writes "\" as the separator;
  // unzip turns it into "/".
  for (const name of names) {
    if (/^[\\/]/.test(name) || name.split(/[\\/]/).includes("..") || name.includes(":")) {
      throw new Rejected(`Unsafe path in the zip: \`${name}\``);
    }
  }
  try {
    execFileSync("unzip", ["-q", "-o", zip, "-d", into], { stdio: "ignore" });
  } catch (e) {
    // 1: warnings only, like the backslash one.
    if (e.status !== 1) {
      throw new Rejected("The zip couldn't be unpacked.");
    }
  }
}

// mod.json at the top of the zip, or in its one folder (as Export makes it).
async function findMod(root) {
  const entries = (await readdir(root, { withFileTypes: true })).filter(e => e.name !== "__MACOSX");
  if (entries.some(e => e.isFile() && e.name === "mod.json")) {
    return { dir: root, folder: null };
  }
  if (entries.length === 1 && entries[0].isDirectory()) {
    const dir = join(root, entries[0].name);
    if ((await readdir(dir)).includes("mod.json")) {
      return { dir, folder: entries[0].name };
    }
  }
  throw new Rejected("No mod.json at the top of the zip or in its one folder.");
}

async function main() {
  if (!REPO || !ISSUE_AUTHOR) {
    throw new Error("REPO and ISSUE_AUTHOR must be set.");
  }
  const work = await mkdtemp(join(tmpdir(), "mod-"));
  const zip = join(work, "mod.zip");
  const unpacked = join(work, "unpacked");
  await mkdir(unpacked);
  await download(zipURL(ISSUE_BODY), zip);
  unzip(zip, unpacked);
  const { dir, folder } = await findMod(unpacked);
  await rm(join(dir, "__MACOSX"), { recursive: true, force: true });

  const raw = JSON.parse(await readFile(join(dir, "mod.json"), "utf8").catch(() => "null"));
  const id = ID_RE.test(raw?.id ?? "") ? raw.id : folder;
  if (!id || !ID_RE.test(id)) {
    throw new Rejected('Add an `"id"` to mod.json (lower-case letters, digits, - and _), or zip the mod\'s folder named after it.');
  }

  // Updates: only from someone who submitted it, and a higher version.
  const owners = await readOwners();
  const target = join(MODS_DIR, id);
  const existing = JSON.parse(await readFile(join(target, "mod.json"), "utf8").catch(() => "null"));
  if (existing) {
    const allowed = (owners[id] ?? []).map(s => s.toLowerCase());
    if (!allowed.includes(ISSUE_AUTHOR.toLowerCase())) {
      throw new Rejected(`A mod called \`${id}\` is already in the store, submitted by someone else. Pick another id, or ask its author to add you.`);
    }
    if (compareVersions(raw?.version ?? "0", existing.version ?? "0") <= 0) {
      throw new Rejected(`\`${id}\` is at ${existing.version} in the store; raise \`"version"\` in mod.json.`);
    }
  }

  // Point the mod at the store, so installed copies update from here.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const manifest = {
      id,
      ...raw,
      author: raw.author || ISSUE_AUTHOR,
      homepage: raw.homepage || `https://github.com/${REPO}/tree/main/mods/${id}`,
      ...storeURLs(REPO, id, raw.version),
    };
    manifest.id = id;
    await writeFile(join(dir, "mod.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  const check = await checkMod(dir, id);
  if (check.errors.length) {
    throw new Rejected(`The mod has problems:\n\n${bullets(check.errors)}`);
  }

  await rm(target, { recursive: true, force: true });
  await mkdir(MODS_DIR, { recursive: true });
  await cp(dir, target, { recursive: true });
  if (!existing) {
    owners[id] = [ISSUE_AUTHOR];
    const sorted = Object.fromEntries(Object.entries(owners).sort(([a], [b]) => a.localeCompare(b)));
    await writeFile("owners.json", `${JSON.stringify(sorted, null, 2)}\n`);
  }

  const { manifest } = check;
  const verb = existing ? `Update ${id} ${existing.version} → ${manifest.version}` : `Add ${id} ${manifest.version}`;
  const scriptNote = check.hasScript
    ? "⚠️ **This mod has a script** (`mod.uc.js`), which runs with full access to Firefox. Read every line before merging."
    : "CSS only.";
  await writeFile(join(OUT_DIR, "pr-title.txt"), `${verb}: ${manifest.name}`.slice(0, 200));
  await writeFile(
    join(OUT_DIR, "pr-body.md"),
    [
      `Submitted by @${ISSUE_AUTHOR} in #${ISSUE_NUMBER}. Closes #${ISSUE_NUMBER}.`,
      "",
      `**${manifest.name}** ${manifest.version} by ${manifest.author}`,
      "",
      manifest.description ? `> ${manifest.description.replace(/\n/g, " ")}` : "",
      "",
      scriptNote,
      "",
      `Files:\n\n${bullets(check.files.map(f => `\`${f}\``))}`,
      check.warnings.length ? `\nWarnings:\n\n${bullets(check.warnings)}` : "",
    ].join("\n"),
  );
  await writeFile(
    join(OUT_DIR, "comment.md"),
    [
      `✅ **${manifest.name}** ${manifest.version} passed the checks${existing ? " (update)" : ""}. A pull request is open for review; it goes live on ${pagesURL(REPO)} once merged.`,
      check.hasScript ? "\nIt has a script, so review takes a bit longer." : "",
      check.warnings.length ? `\nWorth fixing (not required):\n\n${bullets(check.warnings)}` : "",
      "\nEditing this issue (a new zip) re-runs the checks and updates the pull request.",
    ].join("\n"),
  );
  await output("ok", "true");
  await output("id", id);
  await output("version", manifest.version);
}

try {
  await main();
} catch (e) {
  const message = e instanceof Rejected ? e.message : `Something went wrong checking the submission: ${e.message}`;
  console.error(message);
  await writeFile(
    join(OUT_DIR, "comment.md"),
    `❌ ${message}\n\nEdit this issue to fix it (attach a new zip), and the checks run again.`,
  );
  await output("ok", "false");
  if (!(e instanceof Rejected)) {
    process.exitCode = 1;
  }
}
