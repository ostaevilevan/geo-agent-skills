---
name: GEO Curator Rules — Capitalization, Consistency, and Bounty Workflow
description: Full curator assistant rules: capitalization policy, naming consistency, entity structure, bounty workflow, and what NOT to do
type: reference
originSessionId: 2c6552bb-ef02-4c1d-91cc-1f8d4ff20c39
---
## Capitalization Rules (NON-NEGOTIABLE)

### Entity names — Space Content Policy
- Capitalize only the **first word** of the entity name
- Example: "Developer tools" not "Developer Tools"
- Exception: proper nouns, official names, and abbreviations keep their standard capitalization
  - "United States", "HIIT", "EU AI act", "European AI Office"
- Remove honorifics and titles from people names (Dr, Mr, Professor, Senator) — use Roles property instead

### Comma-separated relation values in a single cell
- Each relation entity starts with a capital letter (because each is its own entity)
- "Triceps brachii, Anterior deltoid" ✓
- "European Union, China, United States" ✓
- This ONLY applies to relation properties, NOT text data properties

### How to tell the difference
- Property points to other entities (relation) → capitalize each comma-separated value
- Property is descriptive text → normal sentence capitalization

### No abbreviations in entity names
- "United States" not "US" or "USA"
- "European Union" not "EU" (unless "EU" is part of an official name)
- "HIIT" is acceptable because that IS the recognized name

---

## Naming Consistency (NON-NEGOTIABLE)
- One entity = one name = one spelling = one format, everywhere, across ALL tabs
- "Bitcoin" everywhere — never "bitcoin", "BITCOIN", "BTC"
- In a knowledge graph, "Bitcoin" and "bitcoin" are two different entities

---

## Entity Descriptions
- Do NOT start with the entity name or repeat it redundantly
- One or two short sentences (~50 words), designed for preview
- Informative, includes key details relevant to the entity
- Neutral tone — no overly positive or negative language

---

## Avatar / Cover Images
- Avatar: source from X first, then LinkedIn, then official website. Square, min 400×400px, subject centered
- Cover: ideal 2364×640px (or 1192×320 designed at 2×). Subject centered. Proper license.

---

## Bounty Workflow
1. Receive bounty description — no pre-assigned Type or Properties
2. Analyze together: decide Type, Properties, relation tabs, entity list
3. Study example if available — match exact column names, formatting, level of detail
4. Produce data (research thoroughly, build all tabs)
5. Adapt if editor assigns official Type with different Properties
6. Review: naming consistency, cross-tab references, capitalization, no invented data

### One Bounty = One Type
- All rows share the same Type → same set of Properties (columns)
- Main tab = primary entities; additional tabs = supporting relation entities

---

## What NOT to Do
1. Never wait for pre-assigned Type — propose it yourself
2. Never invent data, stats, dates, names, or factual claims
3. Never use inconsistent naming across tabs
4. Never use abbreviations unless they are the official name
5. Never ignore the example — match format exactly if provided
6. Never add Properties beyond what the Type defines
7. Never forget supporting relation entity tabs
8. Never start descriptions with the entity name
9. Never use overly positive or negative language
10. Never submit without cross-checking consistency between all tabs

---

## Person Data Rule
For any person-related data (CEOs, founders, team members): fetch the company's official about/team page FIRST. Search results and articles are discovery tools only. Company website is the source of truth.

---

## Before Creating an Entity
- Always check whether it already exists in Geo
- Use existing types and properties from public spaces whenever possible
- Do NOT use types/properties created in personal spaces
- If what you need doesn't exist, discuss with space editor before adding anything new
