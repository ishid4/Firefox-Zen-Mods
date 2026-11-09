# Firefox-Zen Mods

Community mods for [Firefox-Zen](https://github.com/ishid4/Firefox-Zen).
Browse them at **https://ishid4.github.io/Firefox-Zen-Mods/**.

## Install a mod

In Firefox-Zen, click **Install** on the store page. Firefox asks before
installing it; a mod with a script is installed off, and the Mods tab opens to
turn it on.

Elsewhere (or without the store page):

1. Click **Download** on the store page to get the mod's `.zip`.
2. In Firefox, open the Library's **Mods** tab → **Install…** → **From Zip…** and pick it.

Installed mods check this store for updates (Library → Mods → **Check for updates**).

Mods with a script (`mod.uc.js`) run with full access to Firefox. Every
script is read before it's merged, but only install mods you trust.

## Submit a mod

1. Make your mod (see [Making a mod](https://github.com/ishid4/Firefox-Zen/blob/main/readme_extra.md#making-a-mod)).
   `mod.json` needs a `name` and a `version` like `1.0.0`. Add a `preview.png`.
2. Export it: Library → Mods → your mod → **Export…**.
3. [Open a submission](../../issues/new?template=submit-mod.yml) and drag the zip in.

A bot checks the zip, sets the mod's `id`, `updateURL` and `downloadURL`, and
opens a pull request. It's listed once that's merged. To publish a new
version, raise `version` and submit again; only the people listed for the mod
in `owners.json` can update it.

You can also open a pull request by hand that adds `mods/<id>/`; the
**Check** workflow tells you what to fix.

## How it works

| Piece | What it does |
| --- | --- |
| `.github/ISSUE_TEMPLATE/submit-mod.yml` | The submission form. |
| `.github/workflows/submission.yml` → `scripts/submission.mjs` | Downloads the zip from the issue, checks it, writes `mods/<id>/`, opens a PR and comments on the issue. Edit the issue to re-run. |
| `.github/workflows/check.yml` → `scripts/check.mjs` | Checks every mod on each PR (version raised, store URLs, files, options). |
| `.github/workflows/publish.yml` → `scripts/publish.mjs` | On push to `main` and hourly: zips each new version as `<id>-<version>.zip` in the `mods` release, then deploys the page with `index.json` and every `mods/<id>/mod.json`. |
| `site/` | The store page (plain HTML/JS). In Firefox-Zen its FzStore actor marks `<html data-fz-mods>` with the installed mods, and **Install** sends it a `fz-store-install` event. |
| `site/touch/` | The page a Firefox-Zen touch's share link opens (`/touch/#1.<touch>`; the touch never reaches the server). It shows the touch as text; in Firefox-Zen (`<html data-fz-touches>`, set by its FzTouch actor) **Try it** sends a `fz-touch-try` event, and Firefox-Zen decodes, cleans and previews the touch itself. |
| `.github/workflows/touches.yml` → `scripts/touches.mjs` | Touches published from Firefox-Zen: each is an issue with the touch in it. Checked on open/edit (`scripts/touch-lib.mjs`), written to `touches/<issue>.json` and committed to `main` directly (no pull request), then Publish runs. Rejected ones get a comment saying what to fix; closing the issue removes the touch. |
| `touches/` | The listed touches. Publish copies them to the site with `touches/index.json` (every touch with its likes: 👍 on its issue; ones with 5+ 👎, more than 👍, are left out). Firefox-Zen downloads the whole index, at most hourly. |

Download counts are GitHub's own counts for the release files, summed over
every version (updates count too). Old versions stay in the release so counts
never reset; delete an asset by hand to drop it.

Each mod's `updateURL` is its `mod.json` on the Pages site, which is deployed
after its zip is uploaded, so an update is never announced before it can be
downloaded.

## Setting up the touches gallery

Once, so Firefox-Zen can publish touches and like them (browsing the
gallery works without it):

1. On GitHub: **Settings → Developer settings → GitHub Apps → New GitHub App**.
   - Name: e.g. *Firefox-Zen Touches*; Homepage URL: this repository.
   - **Webhook**: untick *Active*.
   - Tick **Enable Device Flow**. No callback URL is needed.
   - Untick **Expire user authorization tokens** (Firefox-Zen has no client
     secret to refresh them with; people would have to sign in again daily).
   - **Repository permissions → Issues: Read and write**. Nothing else.
   - *Where can this GitHub App be installed?* Only on this account.
2. Create it, then **Install App** → this repository only.
3. Copy the app's **Client ID** into `CLIENT_ID` in Firefox-Zen's
   `JS/firefox-zen-touches-gallery.sys.mjs` and release Firefox-Zen.

Signing in gives Firefox-Zen a token that can only do what the app may:
issues (and their 👍) on this repository, as the person who signed in.

If `main` is protected by a rule that requires pull requests, let
`github-actions[bot]` bypass it, or the Touches workflow can't commit.

## Setting up the repository

One-time, in the repository settings:

- **Pages** → Source: **GitHub Actions**.
- **Actions → General** → Workflow permissions: **Read and write**, and tick
  **Allow GitHub Actions to create and approve pull requests**.
- **Issues → Labels**: create `mod-submission` (the form adds it, and only
  issues with it are processed).
- Optional: **Branches** → protect `main`, require the **Check** workflow.

Preview the page locally (made-up download counts):

```bash
LOCAL=1 REPO=ishid4/Firefox-Zen-Mods node scripts/publish.mjs
npx serve _site
```

To try **Install** against it in Firefox-Zen, set `firefox-zen.mods.store-dev`
to `true` in about:config and restart.
