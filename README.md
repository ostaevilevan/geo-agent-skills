# geo-agent-skills

Claude Code skills for querying and publishing data to the [GEO Protocol](https://www.geobrowser.io) decentralized knowledge graph.

## Skills

| Skill | Purpose |
|---|---|
| [`geo`](./geo/SKILL.md) | **Master skill — read first.** Single entry point bundling the GEO data model, ontology principles, spreadsheet import behavior, property/type provenance and canonical-reuse rules, naming + description standards, the bounty workflow, key root-space IDs, and a map of the skills below. |
| [`geo-query`](./geo-query/SKILL.md) | Query the GEO knowledge graph via GraphQL — look up entities, search by type, paginate, discover schemas. |
| [`geo-publish`](./geo-publish/SKILL.md) | Publish entities and relations via `@geoprotocol/geo-sdk` — create, update, delete, submit to personal or DAO spaces. |
| [`geo-patch`](./geo-patch/SKILL.md) | Patch existing GEO entities with missing relations or properties. Queries state first to avoid duplicates. Additive only — never deletes. |
| [`geo-upload`](./geo-upload/SKILL.md) | Batch-upload entities from a spreadsheet tab. Handles type proposals, relation vs text properties, existing entity reuse, and DAO publishing. |

## Install (Claude Code)

```bash
# all skills
cp -r geo geo-query geo-publish geo-patch geo-upload ~/.claude/skills/

# or one at a time
cp -r geo-patch ~/.claude/skills/
```

## Highlights

### geo — master skill (read first)

`geo` is the single entry point that ties the rest together. It bundles the GEO data model and ontology principles, the spreadsheet **import behavior** (unmatched relation names become mistyped Projects; ambiguous type names bind silently), property/type **provenance** and canonical-reuse rules, naming + description standards, the bounty workflow, and key root-space IDs. Its `references/` folder carries `critical-rules.md` plus snapshots of `ONTOLOGY.md`, `rules.json`, and `curator-rules.md`, so the rules that are easy to miss are always loaded.

### geo-patch — safe patching of existing entities

`geo-patch` fills a gap not covered by the standard `geo-publish` skill: safely adding missing relations or properties to entities that are **already on-chain**, without creating duplicates.

Key rules encoded in the skill:
- **Query before adding** — checks existing relations on each entity before writing
- **Additive only** — never deletes or overwrites unless explicitly asked
- **Deterministic relation IDs** — `slice(from,16) + slice(to,16)` so reruns are idempotent
- **Dual-typing guidance** — for constraint compatibility with Root-space relation properties
- **Logging pattern** — `[PATCH]` vs `[SKIP]` per entity so you can audit what changed

### geo-upload — batch spreadsheet uploads

`geo-upload` is designed for large curator workflows: reading structured data from Excel/XLSX tabs and uploading hundreds of entities in one DAO proposal. Includes curator content rules (capitalization, description formatting, naming conventions).

## Notes

- `geo-query` and `geo-publish` are also available from the official [geobrowser/geo-skills](https://github.com/geobrowser/geo-skills) repo.
- `geo-patch` and `geo-upload` are original skills developed during active GEO curation work.
- All skills target **TESTNET** (`https://testnet-api.geobrowser.io/graphql`).
