# License scope

This repository contains software, a database, textual content, and third-party
metadata. The licenses apply by path and material type; they are not a single
combined license for every file.

| Scope | License |
|---|---|
| `scripts/**`, `viewer/**`, `schema/**`, `Makefile`, `package.json`, `.env.example` | MIT; see [`LICENSE-CODE`](LICENSE-CODE) |
| Database selection, structure, stable IDs, and relationships in `data/**` | ODbL 1.0; see [`LICENSE`](LICENSE) |
| Chinese translations of Marble-authored text and original project-authored documentation or descriptive text | CC BY-SA 4.0; see [`LICENSE-CONTENT`](LICENSE-CONTENT) |
| Upstream Marble database and authored text | ODbL 1.0 and CC BY-SA 4.0 respectively, with attribution required; see [`NOTICE`](NOTICE) and [`PROVENANCE.md`](PROVENANCE.md) |
| Ministry of Education source names and curriculum references | Upstream rights apply. This repository publishes project-defined mapping identifiers and omits curriculum-standard prose. |
| Textbook-derived work titles, author attributions, and source-sequence metadata in `data/cn-topics.json` and related dependency reasons | Not relicensed by this project. Any underlying third-party rights remain with their respective rights holders. |
| License texts (`LICENSE`, `LICENSE-CONTENT`, `LICENSE-CODE`) and third-party notices | Their own stated terms. |
| Local textbook extraction tools listed in `.gitignore` (`scripts/pdf2md.py`, `scripts/vision_ocr.swift`, `scripts/parse-textbooks.mjs`, `scripts/compare-textbooks.mjs`) | Not part of the Git release and not covered by this repository's MIT grant. |

The CC BY-SA grant covers only material for which the project contributors hold
or received the necessary rights. It does not override the exclusions above.
See [`PROVENANCE.md`](PROVENANCE.md) for source-specific details.
