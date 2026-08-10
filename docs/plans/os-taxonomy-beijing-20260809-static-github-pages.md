# Static GitHub Pages Deployment

## Approved design

Deploy the knowledge browser as a self-contained GitHub Pages project site. Static hosting removes AI mastery parsing, chat, and assessment; local `npm start` retains the existing dynamic API and optional AI behavior.

## Step 1 — Extract deterministic read-side browser data

**Files:** `scripts/serve.mjs`, new `scripts/browser-data.mjs`, focused Node tests.

Move the data loading, upstream/local merging, publication filtering, dimensions, textbook-gap parsing, and read-only API response construction out of `serve.mjs` into a reusable module. Keep the existing response payload shapes and local routes unchanged. The module must require an upstream `topics.json` when invoked for static export; it may preserve the local server's current Chinese-only fallback behavior.

**Verify:** existing server-related tests plus new tests comparing representative `summary`, `subjects`, `topics`, `topic/:id`, and `path-data` results before and after extraction.

## Step 2 — Build a deterministic static artifact

**Files:** new `scripts/export-static-site.mjs`, `package.json`, focused Node tests.

Create a zero-dependency exporter taking `--upstream` and `--out`. It copies viewer assets, writes `.nojekyll`, emits static equivalents of every read-only API response required by the viewer, and fails if the required upstream data is absent. Use a single frontend mapping: generate full read payloads as stable files and apply query filters client-side where practical; generate every publishable topic detail as `api/topic/<encoded-id>.json`.

Build output must contain no environment variables, private `.env` data, AI endpoint POST code, or dynamic server implementation.

**Verify:** run exporter against a valid upstream checkout; assert required files exist; compare generated representative JSON payloads to reusable data-module outputs; assert missing upstream fails.

## Step 3 — Make the viewer base-path and static-mode aware

**Files:** `viewer/index.html`, `viewer/app.js`, `viewer/path.js`, `viewer/service-worker.js`, relevant CSS only if AI controls require removal, frontend-focused tests.

Add a build-time viewer configuration identifying local versus static mode and the base URL. Replace root-absolute viewer assets/API URLs with centralized base-relative URL generation. Static mode reads generated JSON and performs filtering locally; local mode preserves dynamic API reads.

In static mode remove all AI controls, handlers, POST requests, and DeepSeek transmission language. Preserve local profile/mastery/localStorage behavior, routes, graph filtering/search, textbook gaps, and offline caching. Scope the service worker to the configured base path and cache static JSON rather than root-only API URLs.

**Verify:** source-level tests for URL mapping/static AI exclusion; local mode regression tests for current route/API functions; static artifact checks for no root-absolute asset/API paths and no AI POST references.

## Step 4 — Publish via GitHub Actions Pages

**Files:** new `.github/workflows/pages.yml`, `README.md`.

Create a Pages workflow triggered by `main` pushes and manual dispatch. It checks out this repository and the exact Marble upstream commit already pinned by CI, uses Node 22, runs the static exporter, uploads the artifact, then deploys it from a dependent job. Give only deployment job `pages: write` and `id-token: write`; configure the `github-pages` environment. Document that repository Settings → Pages must select GitHub Actions and document the static AI limitation.

**Verify:** parse workflow YAML through GitHub-compatible inspection where available; verify it pins the same upstream revision as CI and uploads only the export directory.

## Step 5 — End-to-end static smoke test and cleanup

**Files:** test fixtures only if required; no committed build artifact.

Serve a generated artifact beneath a non-root path to simulate `https://<owner>.github.io/os-taxonomy-beijing/`. Use a browser to load the site, navigate a topic, use graph search/filtering, mark mastery in localStorage, and confirm service-worker registration. Confirm AI controls do not render. Run the existing Node test suite and data publish validation with the fixed upstream checkout.

**Exit criteria:** Pages artifact is reproducible and self-contained; static mode operates under a repository subpath without AI; local dynamic browser behavior remains covered; no generated output is committed.

## Dependency order

`Step 1 → Step 2 → Step 3 → Step 4 → Step 5`.

Steps 2 and 3 can be developed after Step 1 but converge on the artifact contract; execute serially to avoid duplicate URL/data mapping work.
