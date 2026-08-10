# GitHub Pages Static Deployment Design

## Goal

Publish the knowledge browser at the repository GitHub Pages URL as a fully static site. The hosted site must not require a Node server, runtime secrets, or external application backend.

## Scope and decisions

- Deploy through a GitHub Actions Pages workflow, not a `gh-pages` branch and not committed build output.
- Static builds check out the same pinned Marble upstream commit as CI, then construct the same merged, published browser dataset as `scripts/serve.mjs`.
- The deployed artifact contains the viewer and generated JSON files only. It must include `.nojekyll`.
- Hosted pages must work at a project-site base path such as `/os-taxonomy-beijing/`, not only at `/`.
- The static site retains graph browsing, knowledge paths, dimensions, topic filtering/search, textbook-gap browsing, local profiles/mastery state, and offline caching.
- The static site removes AI mastery parsing, AI chat, and AI assessment. It sends no browser input to an AI endpoint and contains no API keys.
- The local Node browser remains available through `npm start`; its dynamic API and optional AI features keep their current behavior.

## Architecture

### Shared data construction

Extract the deterministic read-side data construction currently embedded in `scripts/serve.mjs` into a reusable module. It owns:

- loading local and upstream datasets;
- translated-topic and dependency merging;
- publication filtering from `review-policy.mjs`;
- dimension visibility and topic filtering;
- serialized responses for the existing read-only API surface.

`serve.mjs` consumes this module to preserve its local HTTP API. A new static exporter consumes the same module, preventing a second implementation of publication policy or topic serialization.

Write APIs (`/api/resolve`, `/api/chat`, `/api/assessment`) stay solely in `serve.mjs`; they are excluded from the static export.

### Static API layout

The exporter writes JSON endpoints with filesystem-safe mappings:

- collection endpoints: `api/<endpoint>.json`;
- parameterized collection variants: deterministic query-key filenames or generated index data consumed client-side;
- per-topic detail: `api/topic/<encoded-topic-id>.json`;
- path data: `api/path-data.json`.

The implementation must choose one mapping and centralize URL construction in the frontend API client. The client must not embed absolute `/api` or `/static` URLs.

The artifact should be self-contained: the deployed browser never fetches project source data, an upstream repository, or localhost.

### Viewer modes

The viewer detects static hosting through build-injected configuration in `index.html`.

- **Local mode:** preserve current `/api/*` read and POST behavior.
- **Static mode:** use generated JSON through base-relative URLs; disable all POST-only AI behavior; omit corresponding controls and DeepSeek-transmission text.

Static asset references, the service-worker registration URL, cache matching, and navigation must derive from the configured base path so they work both locally and under a GitHub project site.

### Workflow

Add a Pages workflow independent of the existing CI quality gate:

1. Trigger on `main` pushes and `workflow_dispatch`.
2. Check out this repository and the pinned upstream revision used by `.github/workflows/ci.yml`.
3. Set up Node 22.
4. Run the static exporter with the checked-out upstream path.
5. Upload the generated directory with `actions/upload-pages-artifact`.
6. Deploy from a dependent job with `actions/deploy-pages`, `pages: write`, and `id-token: write` permissions.

Repository Pages settings must use **GitHub Actions** as the publishing source. This one-time repository setting cannot be committed in the repository.

## Error behavior

- Build fails when a required data input or the upstream checkout is absent; it must not silently publish an incomplete Chinese-only data view.
- Static reads surface the current frontend loading/error states when a generated file is unavailable or malformed.
- AI entry points do not appear in static mode; there is no nonfunctional fallback control.

## Verification

Add focused tests for reusable data construction and static output where the project test conventions support them. At minimum verify:

- exported topic and path payloads match the local API payloads for representative endpoints;
- the build output has no absolute root asset/API references that break a project-site base path;
- static output contains no AI POST endpoint reference or credential-derived content;
- the exporter fails without the required upstream data.

Smoke-test the artifact with a local static server mounted under a non-root path, load it in a browser, and exercise a topic route, graph filter/search, local mastery operation, and service-worker registration. Run the existing relevant Node tests and the data validation command before delivery.

## Non-goals

- Hosting or proxying AI functionality.
- Changing data-review or publication policy.
- Replacing the local Node service.
- Adding a third-party static-site generator or frontend dependency.
