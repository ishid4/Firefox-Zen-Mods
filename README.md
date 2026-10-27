# Firefox-Zen Mods

Community mods for [Firefox-Zen](https://github.com/ishid4/Firefox-Zen).
Browse them at **https://ishid4.github.io/Firefox-Zen-Mods/**.

## Install a mod

1. Click **Download** on the store page to get the mod's `.zip`.
2. In Firefox, open the Library's **Mods** tab → **Install from zip…** and pick it.

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
| `site/` | The store page (plain HTML/JS). |

Download counts are GitHub's own counts for the release files, summed over
every version (updates count too). Old versions stay in the release so counts
never reset; delete an asset by hand to drop it.

Each mod's `updateURL` is its `mod.json` on the Pages site, which is deployed
after its zip is uploaded, so an update is never announced before it can be
downloaded.

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
