// A touch published from Firefox-Zen is an issue (see touch-lib.mjs); this
// runs on every issue event (.github/workflows/touches.yml) and keeps
// touches/<issue number>.json in step with it, with no pull request:
// - opened / edited / reopened, and the touch checks out: written (or
//   rewritten); the issue gets the "touch" label and, the first time, a
//   comment saying it's listed.
// - it doesn't check out: no file (an earlier version is removed), the
//   "touch-rejected" label and a comment saying what to fix. Editing the
//   issue (Firefox-Zen's Update does) runs this again.
// - closed (Unpublish in Firefox-Zen, or a maintainer): removed.
// Issues without the marker are left alone.
//
// Writes "changed=true" to GITHUB_OUTPUT when touches/ changed; the workflow
// commits it and runs Publish (pushes made with the workflow's token don't
// start other workflows by themselves).
//
// Env: GITHUB_EVENT_PATH, GH_TOKEN, REPO, GITHUB_OUTPUT. DRY=1 writes files
// but doesn't call GitHub (prints what it would do).

import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MARKER, MAX_PER_AUTHOR, TOUCHES_DIR, checkTouch, readIssueBody } from "./touch-lib.mjs";

const { GITHUB_EVENT_PATH, GH_TOKEN, REPO, GITHUB_OUTPUT, DRY } = process.env;
const LISTED = "touch";
const REJECTED = "touch-rejected";

const event = JSON.parse(await readFile(GITHUB_EVENT_PATH, "utf8"));
const issue = event.issue;
if (!issue || issue.pull_request || !String(issue.body ?? "").includes(MARKER)) {
  console.log("Not a touch.");
  process.exit(0);
}

const number = issue.number;
const file = join(TOUCHES_DIR, `${number}.json`);
const labels = new Set((issue.labels ?? []).map(l => (typeof l === "string" ? l : l.name)));

async function github(method, path, body) {
  if (DRY) {
    console.log(`[dry] ${method} ${path}`, body ? JSON.stringify(body).slice(0, 300) : "");
    return null;
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

const comment = text => github("POST", `issues/${number}/comments`, { body: text });
const addLabel = name => !labels.has(name) && github("POST", `issues/${number}/labels`, { labels: [name] });
const removeLabel = name => labels.has(name) && github("DELETE", `issues/${number}/labels/${encodeURIComponent(name)}`);

async function existing() {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function changed() {
  if (GITHUB_OUTPUT) {
    await appendFile(GITHUB_OUTPUT, "changed=true\n");
  }
}

async function remove() {
  if (await existing()) {
    await rm(file);
    await changed();
    console.log(`Removed ${file}.`);
  }
}

// How many listed touches an author has, this one aside.
async function countByAuthor(login) {
  let n = 0;
  for (const name of await readdir(TOUCHES_DIR).catch(() => [])) {
    if (name === `${number}.json` || !name.endsWith(".json")) {
      continue;
    }
    try {
      n += JSON.parse(await readFile(join(TOUCHES_DIR, name), "utf8")).author === login ? 1 : 0;
    } catch {}
  }
  return n;
}

if (event.action === "closed" || issue.state === "closed") {
  await remove();
  process.exit(0);
}

const author = issue.user?.login ?? "";
const parsed = readIssueBody(issue.body);
let { touch, errors } = parsed?.data ? checkTouch(parsed.data) : { touch: null, errors: [parsed?.error ?? "No touch found."] };
if (touch && (await countByAuthor(author)) >= MAX_PER_AUTHOR) {
  touch = null;
  errors = [`You have ${MAX_PER_AUTHOR} touches listed already: unpublish one first.`];
}

if (!touch) {
  await remove();
  await addLabel(REJECTED);
  await removeLabel(LISTED);
  await comment(
    [
      "This touch can't be listed yet:",
      "",
      ...errors.map(e => `- ${e}`),
      "",
      "Fix it in Firefox-Zen and use **Update the published touch** (or edit this issue); it's checked again right away.",
    ].join("\n")
  );
  console.log(`Rejected #${number}: ${errors.join(" ")}`);
  process.exit(0);
}

const before = await existing();
const now = new Date().toISOString();
const record = {
  ...touch,
  id: number,
  author,
  url: issue.html_url,
  created: before?.created ?? issue.created_at ?? now,
  updated: now,
};
// Unchanged touch (an edit to the issue's text only): nothing to commit.
const same = before && JSON.stringify({ ...before, updated: null }) === JSON.stringify({ ...record, updated: null });
if (!same) {
  await mkdir(TOUCHES_DIR, { recursive: true });
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  await changed();
}
const firstTime = !labels.has(LISTED);
await addLabel(LISTED);
await removeLabel(REJECTED);
if (firstTime) {
  await comment(
    `Listed: **${touch.name}** shows up for everyone on its site within a few minutes (Firefox-Zen → the Touches button there). ` +
      "Likes are 👍 on this issue. Close the issue (or Unpublish in Firefox-Zen) to take it down."
  );
}
console.log(same ? `#${number} unchanged.` : `Wrote ${file}.`);
