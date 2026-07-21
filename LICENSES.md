# License scope

This repository contains software, a database, textual content, and third-party
metadata. The licenses apply by path and material type; they are not a single
combined license for every file.

| Scope | License |
|---|---|
| `scripts/**`, `viewer/**`, `schema/**`, `Makefile`, `package.json`, `.env.example` | MIT; see [`LICENSE-CODE`](LICENSE-CODE) |
| Database selection, structure, stable IDs, and relationships in `data/**` | ODbL 1.0; see [`LICENSE`](LICENSE) |
| Chinese translations of Marble-authored text and original project-authored documentation, descriptions, evidence, and assessment prompts | CC BY-SA 4.0; see [`LICENSE-CONTENT`](LICENSE-CONTENT) |
| Upstream Marble database and authored text | ODbL 1.0 and CC BY-SA 4.0 respectively, with attribution required; see [`NOTICE`](NOTICE) and [`PROVENANCE.md`](PROVENANCE.md) |
| Ministry of Education source names and project-defined curriculum mapping identifiers | Factual metadata. The project claims no exclusive copyright in the facts and grants no rights to omitted curriculum-standard prose. |
| Textbook-derived work titles, some author names, and source references in `data/cn-topics.json` and related dependency reasons | Factual metadata used for identification, indexing, and provenance. The project claims no exclusive copyright in these facts. Project-authored text and database arrangement remain covered by CC BY-SA 4.0 and ODbL 1.0 respectively. |
| License texts (`LICENSE`, `LICENSE-CONTENT`, `LICENSE-CODE`) and third-party notices | Their own stated terms. |
| Local textbook extraction tools listed in `.gitignore` (`scripts/pdf2md.py`, `scripts/vision_ocr.swift`, `scripts/parse-textbooks.mjs`, `scripts/compare-textbooks.mjs`) | Not part of the Git release and not covered by this repository's MIT grant. |

The licenses cover only material present in this repository and for which the
respective licensors hold the necessary rights. They grant no rights to omitted
textbook prose, illustrations, exercises, page layouts, page numbers, PDFs, or
converted Markdown. See [`PROVENANCE.md`](PROVENANCE.md) for source details.
