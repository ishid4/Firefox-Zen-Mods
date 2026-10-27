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

const count = n => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`);

function badge(text, title, warn = false) {
  const el = document.createElement("span");
  el.className = warn ? "badge warn" : "badge";
  el.textContent = text;
  el.title = title;
  return el;
}

function card(mod) {
  const node = template.content.firstElementChild.cloneNode(true);
  const img = node.querySelector("img");
  if (mod.preview) {
    img.src = mod.preview;
    img.alt = `${mod.name} preview`;
    img.onerror = () => {
      img.remove();
      node.querySelector(".shot").classList.add("empty");
    };
  } else {
    img.remove();
    node.querySelector(".shot").classList.add("empty");
  }
  node.querySelector(".name").textContent = mod.name;
  node.querySelector(".version").textContent = mod.version;
  node.querySelector(".author").textContent = mod.author ? `by ${mod.author}` : "";
  node.querySelector(".desc").textContent = mod.description;
  node.querySelector(".downloads").textContent = count(mod.downloads);
  const badges = node.querySelector(".badges");
  if (mod.script) {
    badges.append(badge("Script", "Runs a script with full access to Firefox. Reviewed before listing.", true));
  }
  if (mod.contentStyles) {
    badges.append(badge("Pages", "Also styles web pages."));
  }
  if (mod.options) {
    badges.append(badge(`${mod.options} option${mod.options > 1 ? "s" : ""}`, "Settings in the Mods tab."));
  }
  const download = node.querySelector(".download");
  download.href = mod.download;
  download.setAttribute("download", "");
  node.querySelector(".source").href = mod.source;
  return node;
}

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
  const next = new URLSearchParams();
  if (state.sort !== "popular") next.set("sort", state.sort);
  if (state.q) next.set("q", state.q);
  if (state.cssOnly) next.set("css", "1");
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
    render();
  })
  .catch(() => {
    status.textContent = "Couldn't load the mod list. Try reloading.";
  });
