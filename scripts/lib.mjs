// Shared by the workflows: checks a mod folder the way Firefox-Zen's loader
// (JS/firefox-zen-mods.sys.mjs) reads it, plus the store's own rules.

import { lstat, readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";

export const MODS_DIR = "mods";
export const RELEASE_TAG = "mods";
export const MAX_ZIP = 20 * 1024 * 1024; // the loader refuses bigger downloads
export const MAX_UNPACKED = 50 * 1024 * 1024;
export const MAX_FILES = 300;

export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PREF_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVED = new Set(["enabled", "trusted", "safe-mode", "auto-update-check", "last-update-check"]);
// No "-" so "<id>-<version>.zip" splits at its last "-".
export const VERSION_RE = /^\d+(\.\d+){0,3}$/;
const OPTION_TYPES = new Set(["bool", "number", "select", "color", "button"]);
const DEFAULT_FILES = {
  styles: ["style.css"],
  contentStyles: ["content.css"],
  script: ["mod.uc.js"],
  preview: ["preview.png", "preview.svg", "preview.jpg", "preview.webp"],
};
const ALLOWED_EXT = new Set([
  "", ".css", ".js", ".mjs", ".json", ".md", ".txt", ".ftl", ".html", ".xhtml",
  ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".ico",
  ".woff", ".woff2", ".ttf", ".otf",
]);

// Where a repository's Pages site lives (no custom domain).
export function pagesURL(repo) {
  const [owner, name] = repo.split("/");
  return process.env.PAGES_URL?.replace(/\/?$/, "/") ?? `https://${owner.toLowerCase()}.github.io/${name}/`;
}

export const assetName = (id, version) => `${id}-${version}.zip`;

// What the store writes into every mod.json, so installed copies update from it.
export function storeURLs(repo, id, version) {
  return {
    updateURL: `${pagesURL(repo)}mods/${id}/mod.json`,
    downloadURL: `https://github.com/${repo}/releases/download/${RELEASE_TAG}/${assetName(id, version)}`,
  };
}

// 1.10.0 > 1.9.2, as the loader compares them.
export function compareVersions(a, b) {
  const pa = String(a).split(/[.+-]/);
  const pb = String(b).split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    const diff = numeric ? Number(x) - Number(y) : x.localeCompare(y);
    if (diff) {
      return Math.sign(diff);
    }
  }
  return 0;
}

// Every file under dir as "/"-separated paths. Symlinks are refused: they
// could point anywhere on the runner.
export async function listFiles(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (entry.isSymbolicLink()) {
      throw new Error(`"${rel}" is a symlink.`);
    }
    if (entry.isDirectory()) {
      out.push(...(await listFiles(join(dir, entry.name), `${rel}/`)));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out.sort();
}

const isInside = rel =>
  typeof rel === "string" && rel.split(/[\\/]/).filter(Boolean).every(p => p !== "." && p !== ".." && !p.includes(":"));

const normalize = rel => rel.split(/[\\/]/).filter(Boolean).join("/");

// Checks mods/<id> (or any folder holding a mod.json). Returns
// { manifest, files, hasScript, preview, errors, warnings }.
export async function checkMod(dir, id) {
  const errors = [];
  const warnings = [];
  const result = { manifest: null, files: [], hasScript: false, preview: null, errors, warnings };

  if (!ID_RE.test(id) || RESERVED.has(id)) {
    errors.push(`"${id}" can't be a mod id: lower-case letters, digits, - and _, up to 64 characters.`);
  }
  try {
    result.files = await listFiles(dir);
  } catch (e) {
    errors.push(e.message);
    return result;
  }
  if (result.files.length > MAX_FILES) {
    errors.push(`${result.files.length} files; the limit is ${MAX_FILES}.`);
  }
  let size = 0;
  for (const rel of result.files) {
    size += (await lstat(join(dir, rel))).size;
    if (!ALLOWED_EXT.has(extname(rel).toLowerCase())) {
      errors.push(`"${rel}": ${extname(rel)} files aren't accepted.`);
    }
    if (rel.split("/").some(p => p.startsWith(".") && p !== ".gitkeep")) {
      warnings.push(`"${rel}" is a hidden file.`);
    }
  }
  if (size > MAX_UNPACKED) {
    errors.push(`The mod is ${(size / 1048576).toFixed(1)} MB unpacked; the limit is ${MAX_UNPACKED / 1048576} MB.`);
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(dir, "mod.json"), "utf8"));
  } catch (e) {
    errors.push(e.code === "ENOENT" ? "No mod.json." : `mod.json: ${e.message}`);
    return result;
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    errors.push("mod.json must be an object.");
    return result;
  }
  result.manifest = manifest;

  if (manifest.id !== undefined && manifest.id !== id) {
    errors.push(`mod.json says "id": "${manifest.id}" but the mod is "${id}".`);
  }
  const textField = (key, max, required) => {
    const value = manifest[key];
    if (value === undefined || value === "") {
      if (required) {
        errors.push(`mod.json needs "${key}".`);
      }
    } else if (typeof value !== "string") {
      errors.push(`"${key}" must be text.`);
    } else if (value.trim().length > max) {
      errors.push(`"${key}" is over ${max} characters.`);
    }
  };
  textField("name", 60, true);
  textField("author", 60, false);
  textField("description", 400, false);
  if (!manifest.description) {
    warnings.push("No description.");
  }
  if (typeof manifest.version !== "string" || !VERSION_RE.test(manifest.version)) {
    errors.push(`"version" must look like 1.0.0 (digits and dots), got ${JSON.stringify(manifest.version)}.`);
  }
  if (manifest.homepage !== undefined && !/^https?:\/\//.test(manifest.homepage)) {
    errors.push(`"homepage" must be an http(s) URL.`);
  }

  // Listed files, or the defaults that exist.
  const have = new Set(result.files);
  const resolveList = (key, single) => {
    const listed = manifest[key];
    if (listed === undefined) {
      return DEFAULT_FILES[key].filter(f => have.has(f));
    }
    const list = single ? [listed] : [listed].flat();
    const found = [];
    for (const rel of list) {
      if (!isInside(rel) || !normalize(rel)) {
        errors.push(`"${key}": ${JSON.stringify(rel)} is not a path inside the mod's folder.`);
      } else if (!have.has(normalize(rel))) {
        errors.push(`"${key}": missing file ${rel}.`);
      } else {
        found.push(normalize(rel));
      }
    }
    return found;
  };
  const styles = resolveList("styles");
  const contentStyles = resolveList("contentStyles");
  const script = resolveList("script", true);
  const preview = resolveList("preview", true);
  result.hasScript = script.length > 0;
  result.hasContentStyles = contentStyles.length > 0;
  result.preview = preview[0] ?? null;
  if (!styles.length && !contentStyles.length && !script.length) {
    errors.push("Nothing to load: no styles and no script.");
  }
  if (!result.preview) {
    warnings.push("No preview image (preview.png, .svg, .jpg or .webp).");
  }

  // Remote code in CSS skips review.
  for (const rel of [...styles, ...contentStyles]) {
    const css = await readFile(join(dir, rel), "utf8").catch(() => "");
    if (/@import\s+(url\()?\s*["']?\s*(https?:)?\/\//i.test(css)) {
      errors.push(`${rel} imports a remote stylesheet; ship the file inside the mod instead.`);
    } else if (/url\(\s*["']?\s*(https?:)?\/\//i.test(css)) {
      warnings.push(`${rel} loads something from the web (url(http…)).`);
    }
  }

  if (manifest.options !== undefined) {
    if (!Array.isArray(manifest.options)) {
      errors.push(`"options" must be a list.`);
    } else {
      const seen = new Set();
      for (const o of manifest.options) {
        if (!o || typeof o !== "object" || !PREF_RE.test(o.pref ?? "")) {
          errors.push(`An option has no valid "pref" (lower-case letters, digits, - and _).`);
        } else if (!OPTION_TYPES.has(o.type)) {
          errors.push(`Option "${o.pref}" has an unknown type "${o.type}" (bool, number, select, color or button).`);
        } else if (seen.has(o.pref)) {
          errors.push(`Option "${o.pref}" is listed twice.`);
        } else if (o.type === "select" && !(Array.isArray(o.choices) && o.choices.length)) {
          errors.push(`Option "${o.pref}" has no choices.`);
        } else if (o.type === "number" && Number.isFinite(o.min) && Number.isFinite(o.max) && o.max < o.min) {
          errors.push(`Option "${o.pref}": max is below min.`);
        }
        if (o?.pref) {
          seen.add(o.pref);
        }
      }
    }
  }
  return result;
}

// owners.json: mod id -> GitHub logins allowed to submit updates to it.
export async function readOwners() {
  try {
    return JSON.parse(await readFile("owners.json", "utf8"));
  } catch {
    return {};
  }
}

export async function modIds() {
  const entries = await readdir(MODS_DIR, { withFileTypes: true }).catch(() => []);
  return entries.filter(e => e.isDirectory() && !e.name.startsWith(".")).map(e => e.name).sort();
}
