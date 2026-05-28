---
name: geo
description: "Master GEO Protocol knowledge skill - the single entry point for any work on the Geo knowledge graph. Read this FIRST for: querying the graph, deciding how to model an entity/type/property, building a bounty spreadsheet, uploading/patching/publishing entities, or auditing data. Covers the data model, the 13 ontology principles, spreadsheet IMPORT BEHAVIOR (unmatched relation names become mistyped Projects; ambiguous type names bind silently), property/type PROVENANCE and canonical reuse, naming + description standards, the bounty workflow, key root-space IDs, and a map of the specialized sub-skills (geo-query, ontology-advisor, geo-upload, geo-patch, geo-publish). Triggers on: 'geo skills', 'geo rules', 'geo bounty', 'upload to geo', 'model this in geo', 'is this canonical', and any task touching the Geo graph."
metadata:
  author: levan
  version: "1.0.0"
---

# GEO Protocol — Master Skill

The single entry point. Read this before any Geo task. It bundles the rules that are easy to miss and routes to the specialized sub-skills for detail.

## Sub-skills — when to use which

| Skill | Use it for |
|---|---|
| **geo-query** | Read the graph via GraphQL: look up entities, search by type, resolve a name to an entity ID, discover a type's schema. Read-only. |
| **ontology-advisor** | Modeling decisions: should I create a type/property, find duplicates/drift, **canonical + provenance checks**, draft descriptions. Read-only. Its `references/ONTOLOGY.md` is the judgment prior; `references/rules.json` holds mechanical lookups; `scripts/helpers.py` has the live primitives. Run scripts from inside `scripts/`. |
| **geo-upload** | Bulk-upload entities from a spreadsheet tab via the SDK (type proposals, relation-vs-text, existing-entity reuse, DAO publish). |
| **geo-patch** | Add missing relations/properties to entities **already on-chain**. Additive only, never deletes; query state first. |
| **geo-publish** | Create/update/delete entities and relations via `@geoprotocol/geo-sdk`. |

Bundled reference docs (in this folder — the skill is self-contained):
- `references/critical-rules.md` — import behavior + provenance + naming/description standards, written out in full (the rules that are easy to miss).
- `references/ONTOLOGY.md` — principles, data model, canonical core types, content standards (snapshot of the ontology-advisor judgment prior).
- `references/rules.json` — canonical property names, type duplications, import behavior, value/naming rules (snapshot).
- `references/curator-rules.md` — capitalization, naming consistency, what-not-to-do, bounty workflow (snapshot).

These snapshots are the **rules**; the **live graph is the source of truth**. For live queries and the canonical/provenance helper functions use `geo-query` and `ontology-advisor` (`scripts/helpers.py`).

## The rules that bite (read `references/critical-rules.md` for the full version)

### A. Spreadsheet import behavior (the #1 source of silent errors)
- Relations resolve **by NAME**, automatically.
- An **unmatched** relation/Types name is **silently created as a new entity typed `Project`** — every relation target must already exist in the graph OR be a typed row in the same upload, else it dangles into a mistyped Project.
- An **ambiguous** name (e.g. `Person` matches 7+ types, `Project` 2+) **binds to one at random, no prompt**. Put a resolved **ID** in the Types cell when the type name is not unique.
- Geo links relations to **other rows in the same upload** (intra-batch) and creates them with the correct type — so build **one self-contained multi-tab workbook**, never split into create-first + main files.
- `Employment, Education, Roles, Audit, Funding rounds` are **relation-entity properties** (carry context on an intermediary entity) and **cannot be CSV-imported** — route to SDK/geo-publish or leave for manual.
- Every import is a **proposal** with a preview; nothing publishes until accepted.

### B. Provenance & canonical reuse (properties/types are GLOBAL)
- A property or type is one global entity with a `spaceIds` array; a type **accumulates property associations from every space that attaches it**. The canonical `Person` carries `Bats`/`Throws`/`Also known as` because Baseball and other spaces attached them. **A property appearing on a type does NOT make it canonical.**
- **Before using any property, verify it is canonical** (geo-root tier 0, or a canonical domain space >3 members). Use `ontology-advisor` `find_similar_properties(name, canonical_only=True)` + the canonical list in `rules.json`. Flag anything from a personal/tiny space.
- **Description provenance:** the GraphQL `description` aggregates whatever space wrote it; prefer the geo-root value, flag `description_drift`.
- Reuse priority: geo-root → canonical domain space → (flag) personal/tiny.

### C. Naming
- Entity names: **sentence case** (capitalize first word + proper nouns), no parentheticals, people get full name only (no honorifics — titles go in `Roles`). For projects/companies use the official name. One entity = one name = one spelling everywhere.
- Type names: singular, sentence case. Relation/multivalue property names: plural.
- Entity names must **not contain commas** (comma splits a relation cell into multiple entities).

### D. Descriptions
~50 words (tighter is fine), **max 2 sentences**, third person, neutral (no superlatives), **no leading article** (The/A/An), **do not start with the entity name**, no em dash (use `-`), don't restate a dedicated property. Vary opening words across a set — don't start ten entries the same way.

### E. Modeling (ontology principles digest)
No duplication (P5, always wins) → relations over plain text (P3) → traceability via Sources (P6) → broad type over narrow (P1) → quality over volume (P7) → reuse shared property names (P8). Context specific to a relationship lives on the **relation entity**, not the endpoint. Use the broadest type that fits; add narrower types only when they unlock ≥2 real properties.

## Bounty / upload workflow
1. **Decide the model** with `ontology-advisor`: does the Type exist? Are its properties canonical (provenance check)? One bounty = one Type.
2. **Build the workbook**: main tab = the entities; **one supporting tab per relational property**, named after the property, with the **target type fully populated** (not bare Name). Where a relation property has no target-type constraint on-chain, name the tab `Flag - <property>` and propose the constraint.
3. **Resolve every relation target** with `geo-query`: unique in graph → use the canonical NAME; ambiguous → emit the entity **ID**; not in graph → add it as a typed row (or flag). Use resolved **type IDs** for ambiguous types in the Type column.
4. **Descriptions / naming** per sections C–D. No invented data — stats, dates, names must be sourced.
5. **Upload** via `geo-upload` (spreadsheet) or `geo-publish` (SDK) as a proposal. **Show the plan and wait for explicit confirmation before running.**

## Key root-space IDs (reuse, never recreate)
Space: geo-root `a19c345ab9866679b001d7d2138d88a1` · system root `08c4f09378584b7c9b94b82e448abcff`
Types: Person `7ed45f2bc48b419e8e4664d5ff680b0d` · Project `484a18c5030a499cb0f2ef588ff16d50` · Topic `5ef5a5860f274d8e8f6c59ae5b3e89e2` · Tag `e0fcc66c9e8643f480802469d8a1a93a` · Claim `96f859efa1ca4b229372c86ad58b694b` · Company `e059a29e6f6b437bbc15c7983d078c0d`
Data types: Text `9edb6fcce4544aa5861139d7f024c010` · Integer `149fd752d9d04f80820d1d942eea7841` · Boolean `7aa4792eeacd41868272fa7fc18298ac` · Date `e661d10292794449a22367dbae1be05a` · Relation `4b6d9fc1fbfe474c861c83398e1b50d9`
Datetime properties need full RFC 3339 (`2024-01-15T00:00:00Z`). Wrong value-type = silent drop.
TESTNET GraphQL: `https://testnet-api.geobrowser.io/graphql`

## Hard guardrails
- Never run a script, edit a spreadsheet, or publish without explicit user confirmation (show the plan first).
- Never write delete scripts against a Geo space.
- Query existing relations before adding (avoid duplicates).
- Verify on-chain names match the sheet before building relation ops.
