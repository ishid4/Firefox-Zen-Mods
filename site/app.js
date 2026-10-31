// Lists index.json (built by scripts/publish.mjs). Everything in it comes from
// submitted mods, so it only goes into the page as text.

const $ = sel => document.querySelector(sel);
const grid = $("#grid");
const status = $("#status");
const search = $("#q");
const cssOnly = $("#css-only");
const template = $("#card");

const SORTS = {
  popular: (a, b) => b.downloads - a.downloads || a.name.localeCompare(b.name),
  updated: (a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""),
  new: (a, b) => (b.added ?? "").localeCompare(a.added ?? ""),
  name: (a, b) => a.name.localeCompare(b.name),
};

const params = new URLSearchParams(location.search);
const state = {
  sort: SORTS[params.get("sort")] ? params.get("sort") : "popular",
  q: params.get("q") ?? "",
  cssOnly: params.get("css") === "1",
};
let mods = [];
let loaded = false;

// In Firefox-Zen, its FzStore actor (JS/firefox-zen-store.sys.mjs there) puts
// { installed: { id: version }, busy, error } on <html data-fz-mods> and
// installs a mod on a "fz-store-install" event. Elsewhere this is null.
function zen() {
  try {
    return JSON.parse(document.documentElement.dataset.fzMods ?? "null");
  } catch {
    return null;
  }
}

// Like Firefox-Zen's: 1.10.0 > 1.9.2.
function compareVersions(a, b) {
  const pa = String(a).split(/[.+-]/);
  const pb = String(b).split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const diff = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x.localeCompare(y);
    if (diff) {
      return Math.sign(diff);
    }
  }
  return 0;
}

function installButton(mod, state) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button primary grow";
  const have = state.installed?.[mod.id];
  if (state.busy === mod.id) {
    button.textContent = have ? "Opening Mods tab…" : "Installing…";
    button.disabled = true;
  } else if (!have) {
    button.textContent = "Install";
  } else if (compareVersions(mod.version, have) > 0) {
    button.textContent = `Update from ${have}`;
    button.title = "Review the update in the Library's Mods tab";
  } else {
    button.textContent = "✓ Installed";
    button.classList.replace("primary", "installed");
    button.title = "Installed. Click to open it in the Library's Mods tab";
  }
  button.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("fz-store-install", { detail: mod.id, bubbles: true }));
  });
  return button;
}

const count = n => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`);

const dialog = $("#detail");
// The mod open in the popup (also ?mod=<id>), kept across renders.
let openId = params.get("mod");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const day = iso => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");

function badge(text, title, warn = false) {
  const span = el("span", warn ? "badge warn" : "badge", text);
  span.title = title;
  return span;
}

// What a mod changes, as chips: [title, short text, tooltip, warn].
function changes(mod) {
  const list = [];
  if (mod.styles) {
    list.push(["Browser UI", "CSS", "Restyles Firefox itself: tabs, sidebar, toolbars."]);
  }
  if (mod.contentStyles) {
    list.push(["Web pages", "CSS", "Also styles websites."]);
  }
  if (mod.script) {
    list.push(["Script", "full access", "Runs its own code with full access to Firefox. It's installed turned off, and Firefox asks before running it.", true]);
  }
  return list;
}

const withUnit = (n, unit) => (unit ? `${n} ${unit}` : String(n));

// An option's [values, default] as text.
function describe(o) {
  switch (o.type) {
    case "bool":
      return ["On / off", o.default === null ? "" : o.default ? "On" : "Off"];
    case "number": {
      const range =
        o.min !== null && o.max !== null
          ? `${o.min}–${withUnit(o.max, o.unit)}`
          : o.min !== null
            ? `${withUnit(o.min, o.unit)} or more`
            : o.max !== null
              ? `Up to ${withUnit(o.max, o.unit)}`
              : "Number";
      return [range, o.default === null ? "" : withUnit(o.default, o.unit)];
    }
    case "select": {
      const label = v => o.choices.find(c => c.value === String(v))?.label || String(v);
      return [o.choices.map(c => c.label || c.value).join(" · "), o.default === null ? "" : label(o.default)];
    }
    case "color":
      return ["Color", typeof o.default === "string" ? o.default : ""];
    case "button":
      return ["Button", ""];
    default:
      return [o.type, ""];
  }
}

function optionRow(o) {
  const row = el("tr");
  const name = el("td", "", o.label);
  if (o.hint) {
    name.append(el("span", "opt-hint", o.hint));
  }
  const [values, value] = describe(o);
  const def = el("td");
  if (value) {
    const text = el("span", "opt-default", value);
    if (o.type === "color" && /^#[0-9a-f]{6}$/i.test(value)) {
      const swatch = el("span", "swatch");
      swatch.style.background = value;
      text.prepend(swatch);
    }
    def.append(text);
  } else {
    def.textContent = "–";
  }
  row.append(name, el("td", "", values), def);
  return row;
}

function fillPreview(shot, mod) {
  const img = shot.querySelector("img");
  shot.classList.remove("empty");
  if (!mod.preview) {
    img.hidden = true;
    shot.classList.add("empty");
    return;
  }
  img.hidden = false;
  img.src = mod.preview;
  img.alt = `${mod.name} preview`;
  img.onerror = () => {
    img.hidden = true;
    shot.classList.add("empty");
  };
}

// Install (in Firefox-Zen), Download and Source, into the popup.
function fillActions(root, mod) {
  const actions = root.querySelector(".actions");
  const download = el("a", "button primary grow", "Download");
  download.href = mod.download;
  download.setAttribute("download", `${mod.id}-${mod.version}.zip`);
  const source = el("a", "button", "Source");
  source.href = mod.source;
  actions.replaceChildren(download, source);
  if (mod.homepage && mod.homepage !== mod.source) {
    const home = el("a", "button", "Homepage");
    home.href = mod.homepage;
    actions.append(home);
  }
  const state = zen();
  const error = root.querySelector(".error");
  error.hidden = true;
  if (state) {
    // Install leads; the zip stays one click away.
    download.classList.remove("primary", "grow");
    download.title = "Download the .zip, to install by hand or keep";
    download.before(installButton(mod, state));
    if (state.error?.id === mod.id) {
      error.textContent = `Couldn't install: ${state.error.message}`;
      error.hidden = false;
    }
  }
}

function card(mod) {
  const node = template.content.firstElementChild.cloneNode(true);
  fillPreview(node.querySelector(".shot"), mod);
  const link = node.querySelector(".open");
  link.href = `?mod=${encodeURIComponent(mod.id)}`;
  link.textContent = mod.name;
  link.addEventListener("click", e => {
    if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      openMod(mod.id);
    }
  });
  node.querySelector(".version").textContent = mod.version;
  node.querySelector(".author").textContent = mod.author ? `by ${mod.author}` : "";
  node.querySelector(".desc").textContent = mod.description;
  node.querySelector(".downloads").textContent = count(mod.downloads);
  const badges = node.querySelector(".badges");
  const options = mod.options?.length ?? 0;
  if (mod.script) {
    badges.append(badge("Script", "Runs its own code with full access to Firefox", true));
  }
  if (mod.contentStyles) {
    badges.append(badge("Pages", "Also styles web pages"));
  }
  if (options) {
    badges.append(badge(`${options} option${options > 1 ? "s" : ""}`, "Settings in the Mods tab"));
  }
  return node;
}

function fillDialog(mod) {
  fillPreview(dialog.querySelector(".shot"), mod);
  dialog.querySelector(".name").textContent = mod.name;
  dialog.querySelector(".version").textContent = mod.version;
  dialog.querySelector(".author").textContent = mod.author ? `by ${mod.author}` : "";
  dialog.querySelector(".desc").textContent = mod.description;
  const facts = [
    ["Created", day(mod.added)],
    ["Updated", day(mod.updated)],
    ["Downloads", mod.downloads.toLocaleString()],
  ].filter(([, v]) => v);
  dialog.querySelector(".facts").replaceChildren(
    ...facts.map(([k, v]) => {
      const row = el("div");
      row.append(el("dt", "", k), el("dd", "", v));
      return row;
    })
  );
  dialog.querySelector(".changes").replaceChildren(
    ...changes(mod).map(([title, text, tip, warn]) => {
      const item = el("li", warn ? "warn" : "", title);
      item.title = tip;
      item.append(el("span", "", text));
      return item;
    })
  );
  const options = mod.options ?? [];
  dialog.querySelector(".opts-block").hidden = !options.length;
  dialog.querySelector(".opts tbody").replaceChildren(...options.map(optionRow));
  fillActions(dialog, mod);
}

function openMod(id) {
  const mod = mods.find(m => m.id === id);
  if (!mod) {
    openId = null;
    return;
  }
  openId = id;
  fillDialog(mod);
  if (!dialog.open) {
    dialog.showModal();
    dialog.scrollTop = 0;
  }
  syncURL();
}

dialog.addEventListener("close", () => {
  openId = null;
  syncURL();
});
// A click on the backdrop closes it.
dialog.addEventListener("click", e => {
  if (e.target === dialog) {
    dialog.close();
  }
});

function render() {
  const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = mods
    .filter(m => !state.cssOnly || !m.script)
    .filter(m => words.every(w => `${m.name} ${m.author} ${m.description} ${m.id}`.toLowerCase().includes(w)))
    .sort(SORTS[state.sort]);
  grid.replaceChildren(...shown.map(card));
  status.textContent = !mods.length
    ? "No mods yet. Submit the first one!"
    : shown.length
      ? `${shown.length} of ${mods.length} mods`
      : "No mods match.";

  for (const button of document.querySelectorAll("[data-sort]")) {
    button.setAttribute("aria-checked", String(button.dataset.sort === state.sort));
  }
  if (openId) {
    openMod(openId);
  }
  syncURL();
}

function syncURL() {
  const next = new URLSearchParams();
  if (state.sort !== "popular") next.set("sort", state.sort);
  if (state.q) next.set("q", state.q);
  if (state.cssOnly) next.set("css", "1");
  if (openId) next.set("mod", openId);
  history.replaceState(null, "", next.size ? `?${next}` : location.pathname);
}

for (const button of document.querySelectorAll("[data-sort]")) {
  button.addEventListener("click", () => {
    state.sort = button.dataset.sort;
    render();
  });
}
search.value = state.q;
search.addEventListener("input", () => {
  state.q = search.value.trim();
  render();
});
cssOnly.checked = state.cssOnly;
cssOnly.addEventListener("change", () => {
  state.cssOnly = cssOnly.checked;
  render();
});

document.addEventListener("fz-store-state", () => {
  document.body.classList.toggle("zen", !!zen());
  if (loaded) {
    render();
  }
});

fetch("index.json", { cache: "no-cache" })
  .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
  .then(data => {
    mods = data.mods ?? [];
    if (data.repo) {
      $("#submit").href = `https://github.com/${data.repo}/issues/new?template=submit-mod.yml`;
      $("#repo-link").href = `https://github.com/${data.repo}`;
    }
    if (data.generated) {
      $("#generated").textContent = `Download counts from ${new Date(data.generated).toLocaleString()}`;
    }
    loaded = true;
    render();
  })
  .catch(() => {
    status.textContent = "Couldn't load the mod list. Try reloading.";
  });
