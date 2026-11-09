// Touches published from Firefox-Zen (see touches.mjs): reading one out of
// its issue, and checking it.
//
// A touch issue's body has MARKER and the touch as a ```json block, in
// Firefox-Zen's share format: { format: "firefox-zen-touch", version, name,
// scope, edits, css }. Firefox-Zen cleans every touch it downloads again,
// with the browser's own CSS and HTML parsers (anything loading from another
// site goes); this is the gate before it's listed: the shape, the sizes, and
// nothing that plainly loads from elsewhere or runs code.

export const MARKER = "<!-- firefox-zen-touch -->";
export const TOUCHES_DIR = "touches";
export const MAX_PER_AUTHOR = 50;

const MAX_NAME = 80;
const MAX_CSS = 256 * 1024;
const MAX_EDITS = 200;
const MAX_SEL = 500;
const MAX_TEXT = 4000;
const MAX_HTML = 16 * 1024;
const WHERE = ["before", "after", "prepend", "append"];
const FONTS = ["system", "sans", "serif", "mono"];
const SIZES = { fontSize: [6, 200], maxWidth: [100, 4000], padding: [0, 200], radius: [0, 200] };
const COLOR_RE = /^[#a-zA-Z0-9(),.%\s/-]{1,60}$/;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// CSS that loads something from elsewhere (data: is fine).
const CSS_LOADS = [
  [/@import\b/i, "@import"],
  [/url\(\s*(['"]?)(?!data:)/i, "url() to another site"],
  [/image-set\(|cross-fade\(|\bsrc\(|\bimage\(|element\(/i, "image-set() or similar"],
  [/expression\(|-moz-binding|behavior\s*:/i, "old script hooks"],
];
const HTML_BAD = [
  [/<\s*(script|iframe|frame|object|embed|form|link|meta|base|style)\b/i, "a script, frame, form or style tag"],
  [/<[^>]*\son\w+\s*=/i, "an event handler (on…=)"],
  [/javascript:/i, "a javascript: link"],
  [/<[^>]*\s(src|srcset|poster|background|action|formaction)\s*=\s*(['"]?)(?!data:)/i, "something loading from another site"],
  [/url\(\s*(['"]?)(?!data:)/i, "url() to another site"],
];

const str = (v, max) => (typeof v === "string" && v.length <= max ? v : null);

// The touch's JSON from an issue body, or null.
export function readIssueBody(body) {
  if (typeof body !== "string" || !body.includes(MARKER)) {
    return null;
  }
  const m = /```json\s*\n([\s\S]*?)\n```/.exec(body.slice(body.indexOf(MARKER)));
  if (!m) {
    return { error: "There's no ```json block with the touch in it." };
  }
  try {
    return { data: JSON.parse(m[1]) };
  } catch (e) {
    return { error: `The touch isn't valid JSON (${e.message}).` };
  }
}

function checkScope(scope, errors) {
  if (!scope || typeof scope !== "object") {
    errors.push("It has no scope (which pages it's for).");
    return null;
  }
  const value = typeof scope.value === "string" ? scope.value.trim() : "";
  if (scope.type === "domain" || scope.type === "host") {
    if (!HOST_RE.test(value.toLowerCase())) {
      errors.push(`"${value.slice(0, 80)}" isn't a website's address.`);
      return null;
    }
    return { type: scope.type, value: value.toLowerCase() };
  }
  if (scope.type === "prefix") {
    let url;
    try {
      url = new URL(value);
    } catch {}
    if (!url || !/^https?:$/.test(url.protocol) || value.length > 2048 || !HOST_RE.test(url.hostname)) {
      errors.push("Its page address isn't a website's.");
      return null;
    }
    return { type: "prefix", value };
  }
  errors.push(`Unknown scope type "${String(scope.type).slice(0, 20)}".`);
  return null;
}

function checkEdit(e, i, errors) {
  const where = `Element ${i + 1}`;
  const sel = typeof e?.sel === "string" ? e.sel.trim() : "";
  if (!sel || sel.length > MAX_SEL || /[{};]|\/\*|\\$/.test(sel)) {
    errors.push(`${where}: its selector is missing, too long or has { } ;.`);
    return null;
  }
  const style = {};
  for (const [key, value] of Object.entries(e.style ?? {})) {
    if (key === "color" || key === "background") {
      if (typeof value !== "string" || !COLOR_RE.test(value) || value.includes("//")) {
        errors.push(`${where}: ${key} isn't a plain color.`);
        return null;
      }
      style[key] = value;
    } else if (key === "fontFamily") {
      if (!FONTS.includes(value)) {
        errors.push(`${where}: unknown font "${String(value).slice(0, 20)}".`);
        return null;
      }
      style.fontFamily = value;
    } else if (SIZES[key]) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < SIZES[key][0] || n > SIZES[key][1]) {
        errors.push(`${where}: ${key} is out of range.`);
        return null;
      }
      style[key] = Math.round(n);
    } else {
      errors.push(`${where}: unknown style "${key.slice(0, 20)}".`);
      return null;
    }
  }
  const out = { sel, hide: e.hide === true, style };
  if (e.text != null) {
    if (!str(e.text, MAX_TEXT)) {
      errors.push(`${where}: its new text is too long.`);
      return null;
    }
    out.text = e.text;
  }
  if (e.insert) {
    const html = str(e.insert.html, MAX_HTML);
    if (!html || !WHERE.includes(e.insert.where)) {
      errors.push(`${where}: its added HTML is too long or has no place.`);
      return null;
    }
    for (const [re, what] of HTML_BAD) {
      if (re.test(html)) {
        errors.push(`${where}: its added HTML has ${what}.`);
        return null;
      }
    }
    out.insert = { where: e.insert.where, html };
  }
  return out;
}

// { touch, errors }: touch is the cleaned, listable form (without id/author).
export function checkTouch(data) {
  const errors = [];
  if (data?.format !== "firefox-zen-touch") {
    return { touch: null, errors: ["It isn't a Firefox-Zen touch."] };
  }
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name || name.length > MAX_NAME) {
    errors.push(`It needs a name of at most ${MAX_NAME} characters.`);
  }
  const scope = checkScope(data.scope, errors);
  const rawEdits = Array.isArray(data.edits) ? data.edits : [];
  if (rawEdits.length > MAX_EDITS) {
    errors.push(`At most ${MAX_EDITS} elements.`);
  }
  const edits = rawEdits.slice(0, MAX_EDITS).map((e, i) => checkEdit(e, i, errors)).filter(Boolean);
  const css = typeof data.css === "string" ? data.css : "";
  if (css.length > MAX_CSS) {
    errors.push("Its CSS is too long.");
  }
  for (const [re, what] of CSS_LOADS) {
    if (re.test(css)) {
      errors.push(`Its CSS has ${what}: touches in the gallery can't load anything from other sites.`);
    }
  }
  if (!css.trim() && !edits.some(e => e.hide || Object.keys(e.style).length || e.text != null || e.insert)) {
    errors.push("It doesn't change anything.");
  }
  return errors.length
    ? { touch: null, errors }
    : { touch: { format: "firefox-zen-touch", version: 1, name, scope, edits, css }, errors };
}

// The site a scope is for, for grouping and the issue title.
export function siteOf(scope) {
  try {
    return scope.type === "prefix" ? new URL(scope.value).hostname.replace(/^www\./, "") : scope.value;
  } catch {
    return String(scope?.value ?? "");
  }
}
