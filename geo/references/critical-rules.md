# GEO — Critical Rules (the ones that are easy to miss)

These were not surfaced in the operational skills and caused real errors. They are now part of the `geo` skill so they are always loaded. Source: ontology-advisor `ONTOLOGY.md` + `rules.json` (revision 2026-05-21), geo-upload/geo-patch, confirmed against the live graph.

---

## 1. Spreadsheet import behavior (CSV/workbook → geobrowser.io)

Empirically confirmed on geobrowser.io. These govern how a built workbook actually lands.

- **Relations resolve by NAME, automatically.** A relation cell or Types cell value is matched to an existing entity by name with no prompt.
- **Unmatched name → silently created as a NEW entity typed `Project`.** Any relation target that is neither already in the graph NOR present as a typed row in the same upload becomes a mistyped Project. This is the single biggest hazard ("dangling reference"). **Every relation target must be a typed row in the upload or resolve to an existing entity.**
- **Name ambiguity binds silently.** `Person` matches 7+ Type entities; `Project` 2+. A bare ambiguous name binds to ONE at random — no flag. **Emit a resolved entity/type ID** when the name is not unique. (An ID red-flags as "needs linking" but clicking it gives a reliable 1-click confirm pre-filled with the exact entity; a name does not red-flag but may bind wrong.)
- **Intra-batch linking.** Geo links relations to OTHER ROWS in the SAME upload and creates them with the correct type in one proposal. → Build **one self-contained multi-tab workbook**; do NOT split into a create-first file + a main file.
- **Single upload is the goal.** Include the main subjects AND every referenced entity that doesn't yet exist, each as a properly typed row (own tab/rows).
- **Import is a proposal** with a preview step; nothing is published until accepted.

### Relation-entity properties — OUT OF SCOPE for CSV import (v1)
`Employment, Education, Audit, Funding rounds, Roles, Funding round` carry context (dates, role, amount, findings) on an intermediary **relation entity**. CSV import can only make BARE relations, so that context is lost. **Do not flatten them** — route to SDK/geo-publish or manual entry. (So `Roles` on a Person cannot be CSV-imported; `Works at` is a legacy SIMPLE relation that can.)

### Per-relation resolution recipe
For each relation/Types value:
- **Defined in this upload** (matches a typed row's Name) → leave the NAME; intra-batch linking handles it.
- **Unique in the graph** → emit the canonical NAME (auto-resolves, zero clicks).
- **Ambiguous in the graph** (2+ matches) → emit the best entity **ID** (1-click confirm) and list all candidates.
- **Not in upload and not in graph (dangling)** → do NOT leave the bare name (becomes a mistyped Project). Add a typed row for it, or flag for the human.

---

## 2. Property & type provenance (properties/types are GLOBAL)

- A property or type is ONE global entity with a `spaceIds` array. **A type accumulates property associations from every space that attaches it.** The canonical `Person` (`7ed45f2bc48b419e8e4664d5ff680b0d`) is attached to geo-root + Industries + Baseball + Men's work — which is why it carries `Bats`, `Throws`, `Hall of fame`, `Retrosheet person ID` (Baseball) and `Also known as` (a non-canonical space).
- **Reading a property off a type's list does NOT mean it is canonical.** Before using any property, check its provenance.
- **Canonical property names** (reuse these exact names; do not invent synonyms): Name, Description, Cover, Avatar, Tags, Topics, Related entities, Related people, Related projects, Related spaces, Web URL, Publish date, Sources, Website, X, LinkedIn, GitHub, Telegram, Discord, Docs, Year founded.
- **Canonical Person properties**: Name, Description, Avatar, X, Roles, Employment, Education, Works at / Worked at (legacy), Lives in, Key contributions, Skills, Tags, Topics, Published, Gave talk, Appeared on, Tweeted, Worked on. **No alias property** — `Also known as` is NOT canonical (a GitHub login belongs in the GitHub URL, not a fabricated alias field).
- **Reuse priority:** geo-root (tier 0) → canonical domain space with >3 members (tier 1) → personal/tiny space (tier 2, flag as unverified). Use `ontology-advisor`:
  - `find_similar_types(name, canonical_only=True)` / `find_similar_properties(name, canonical_only=True)`
  - `summarize_type(id)` → read `description_canonical` + `description_drift` (NOT the aggregated `description`, which can leak a niche-space override).
  - **Sample before reuse**: name match ≠ semantic match. Inspect sample entities; a populated broad type with the wrong semantics is a name collision, not a reuse target.
- **Known duplications** (`rules.json.known_type_duplications`): `Project` (broad org-like vs project-management) and `Person` (7+ types) — resolve to a specific ID when precision matters.
- **Synonyms `find_similar_properties` will MISS** (no shared substring): Maintainers↔Operator/Owners/Run by; Stages↔Steps/Phases; Year founded↔Founded; Web URL↔URL/Site/Link/Homepage; Sources↔Citations/References; Authors↔Writer/Created by. Check `rules.json.known_property_synonyms` before proposing a new property.

---

## 3. Naming standards

- **Entity names — sentence case**: capitalize only the first word + proper nouns (`Developer tools`, not `Developer Tools`). Proper nouns/official names/recognized abbreviations keep their form (`United States`, `HIIT`, `MIT License`).
- **No parentheticals** in names (`Ethereum (blockchain)` → no). Abbreviations go in a dedicated property; type context goes in Type/Description.
- **People**: full name only, no honorifics (Dr/Prof/President) — those go in `Roles`.
- **No commas in an entity name** — a comma splits a relation cell into multiple entities.
- **One entity = one name = one spelling = one format**, everywhere, across all tabs.
- **Type names** singular, sentence case. **Relation / multi-value property names** plural (`Topics`, `Authors`, `Roles`, `Team members`).

---

## 4. Description standards

- ~50 words, **max 2 sentences**, third person, neutral tone.
- **No leading article** (The/A/An). **Do not start with the entity name** or a restatement of it.
- No superlatives ("leading", "best-in-class", "revolutionary", "state-of-the-art", "cutting-edge", "world's…", …).
- Do not restate a value already in a dedicated property (e.g. founding date when `Year founded` exists).
- No em dash — use a normal hyphen.
- Across a set of entities, **vary the opening word** — don't start many descriptions identically.

---

## 5. Ontology principles (priority order)

1. **No duplication** (always wins) — one entity per real-world thing; merge duplicates, never create a third.
2. **Relations over plain text** — if a value is a real-world thing, link it as a relation entity.
3. **Traceability** — every specific factual claim links to a `Sources` relation entity.
4. **Broad over narrow** — broadest fitting type; narrower only if it adds ≥2 real properties.
5. **Quality over volume** — fewer high-signal entities beat many low-signal stubs.
6. **Consistency through shared property names** — reuse canonical names across types.

Context that only makes sense for a relationship (tenure dates, role, audit findings) lives on the **relation entity**, not the endpoint type.

---

## 6. Value formats & SDK gotchas

- **Datetime** properties need full RFC 3339: `"2024-01-15T00:00:00Z"` (a bare date throws).
- **Wrong value-type = silent drop**: sending `type:"text"` for a Relation/Date property is ignored with no error. Always query the property's real data type.
- **Property data type depends on the owning space**: root-space properties have fixed types; your space's properties are whatever you set (e.g. `Year founded` as Text). A `Format` relation (e.g. URL) changes display only — data type stays Text.
- **Integer display**: the UI shows integers with thousands separators (e.g. `2,013`). Use **Text** for year fields; integers are fine for counts like stars.
- **Dashless UUIDs**: 32-char hex, no dashes (`Id.generate()` / `IdUtils.generate()`).
- **Reuse mandate**: reuse root-space types/properties whenever possible; only create new for genuinely domain-specific fields, and discuss with the space editor first.

---

## 7. Type Proposal document format (what a curator/editor expects)

```
## TypeName
One-paragraph definition of the type.

### PropertyName
One or two sentences explaining the property.
- **Type:** Text | URL | Date | Integer | Boolean | Relation
- **Target:** <Type>        (relations only; may list multiple)
```

Exemplars on disk: `~/Desktop/My best friend/GEO Type Proposal - *.md`, `RC - MAIN TYPE.md`.
