---
name: geo-patch
description: Patch existing GEO Protocol entities with missing relations or properties. Queries existing state first to avoid duplicates. Additive only — never deletes.
---

# GEO Protocol Entity Patch

Follow this workflow when adding missing relations or properties to entities **already on-chain**.

---

## Rule 1 — Query Before Adding (CRITICAL)

The user may have manually added data between script runs. Before adding any relation:

1. **Query the entity's existing relations** via GQL:
```graphql
{
  entity(id: "<ENTITY_ID>", spaceId: "<SPACE_ID>") {
    id
    name
    relations {
      id
      type
      toEntity
    }
  }
}
```

2. **Check** if a relation of the same `type` + `toEntity` already exists
3. **Only add if absent** — adding a duplicate creates two identical relations on the entity

### Batch pattern:
```typescript
// Query all entities of the target type from the space
// For each entity, check its existing relations
// Build ops ONLY for relations that don't already exist
// Log clearly: [PATCH] adding X | [SKIP] X already set
```

---

## Rule 2 — Additive Only, No Deletions

Unless the user **explicitly** asks to delete:
- Never use `Graph.deleteRelation()`
- Never use `Graph.deleteEntity()`
- Never overwrite existing values
- Only **add** what is missing

The user manages cover images, avatars, and some relations manually. Patch scripts must respect all existing data.

---

## Rule 3 — Search Existing Entities for Relation Targets

When adding a relation, the target entity may already exist:

**Search order:**
1. Our working space
2. Instructed spaces (e.g. Places space `84a679ce188f061ac9a92380bac2bab5`)
3. Root space `08c4f09378584b7c9b94b82e448abcff`

Reuse existing entity IDs. Never create duplicates.

---

## Rule 4 — Relation Properties Can Have Multiple Values

A single relation property can accept multiple entity types (e.g. Location accepts City, Country, Region, Continent). Comma-separated values in the spreadsheet mean multiple separate relations.

When patching:
- Check which relations of that type already exist on the entity
- Only add relations that are **absent**
- Follow the data — don't assume a fixed number of relations per property

---

## Rule 5 — Updating Properties (Use Correct Data Type)

**Never assume text.** Query each property's data type from GEO before patching. Sending the wrong type silently fails.

```typescript
const { ops } = Graph.updateEntity({
  id: entityId,
  values: [
    { property: TEXT_PROP,     type: "text",     value: "new value" },
    { property: DATE_PROP,     type: "date",     value: "2024-01-15" },
    { property: DATETIME_PROP, type: "datetime", value: "2024-01-15T00:00:00Z" },
    { property: INT_PROP,      type: "integer",  value: 1865 },
  ],
});
```

**Datetime MUST be full RFC 3339** — `"2024-01-15"` alone throws `Invalid RFC 3339 datetime`. Always use `"2024-01-15T00:00:00Z"`.

**Data type depends on property ownership:**
- Root Space properties have fixed types — if Datetime, you must use RFC 3339.
- Your space's properties — you control the type. `Year Founded` as Text just takes `"1865"`.
- Always query the property's actual data type from GEO. Never assume.

To clear a property value, use `unset`:
```typescript
const { ops } = Graph.updateEntity({
  id: entityId,
  unset: [{ property: PROP_ID }],
});
```

---

## Rule 6 — DAO Publishing

Same pattern as geo-upload: `proposeEdit → voteProposal → executeProposal` with FAST voting, TESTNET, 2-second delays.

---

## Rule 7a — Properties Are Shared Across Types (Same ID)

A property in GEO is a single global entity. The same property ID is reused on every type that adopts it — `c42bcc14d9684ab2a4f32513c974898b` ("Research challenge") works for both AI Tool and Discovery. There is no per-type variant.

**When patching:**
- Use the same property ID regardless of which type's entities you're patching.
- Never create a duplicate "X property for type Y" — search first, reuse always.
- A single patch script can update the same property across multiple types in one edit.

**When the user adds a property to a type:**
- They're attaching an existing global property entity to the type's Properties relation, not creating a new property.
- The property ID stays the same. No script change needed for the new type.

## Rule 7 — Types Live in Multiple Spaces (Same ID)

A type or property is a single entity that can be visible in multiple spaces at once. "Grabbing" a root-space type into our space adds our `spaceId` to its `spaceIds` array — **the ID does not change**.

When the user says "I grabbed the X type into our space":
1. Verify with `{ entity(id: "<TYPE_ID>") { spaceIds } }` — expect our space to appear in the list alongside root
2. **Do not** assume a fork was made. Do not expect a new ID
3. Entities typed as the grabbed type **do not need retyping** — they already point at the correct ID
4. Edits to the type's properties (e.g. changing a Relation value type constraint) apply to the same entity everywhere

Fork-and-replace (creating a new local type with a different ID) is a different, heavier operation. Only do it when the user **explicitly** says "fork" or "create a new local type" — never when they say "grab".

---

## Rule 8 — Dual-typing for constraint compatibility

Many Root-space relation properties constrain their target to a specific Root type (e.g. `Related projects` → Project, `Roles` → Role). Custom types (AI Tool, Research Challenge, Role-variant, etc.) that need to act as valid link targets for these properties must be **dual-typed**: `[CUSTOM_TYPE, ROOT_TYPE]`.

**Pattern:**
- Researchers in Digital Antiquity are typed `[PERSON, RESEARCHER]` so they satisfy every Person-targeting property.
- AI Tools will be typed `[AI_TOOL_TYPE, PROJECT_TYPE]` so they satisfy `Related projects` (→ Project) on Topic.

**When to apply:**
- The target property's `relationValueTypes` constrain to a Root type.
- Your entities have a richer custom type you don't want to discard.

**What breaks without it:**
- Relations still write successfully (no GQL error).
- But the target entity does not appear in any constraint-filtered view, so users browsing the source see an empty slot for that relation.

---

## Rule 9 — Logging

Always log clearly what's being patched vs skipped:
```
[PATCH] University of Kentucky — adding: Sector (Academic institution)
[SKIP]  ETH Zürich — Sector already set (Academic institution)
[PATCH] ETH Zürich — adding: Location (Switzerland)
```

---

## Rule 10 — Deterministic Relation Entity IDs (Idempotent Reruns)

When creating relations via `Graph.createRelation`, always pass a deterministic `entityId` so reruns don't create duplicate relation entities:

```typescript
const relEntityId = `${fromId.slice(0, 16)}${toId.slice(0, 16)}`;

const { ops } = Graph.createRelation({
  fromEntity: fromId,
  toEntity: toId,
  type: PROP_ID,
  entityId: relEntityId, // stable — same result on every rerun
  position: Position.generateBetween(null, null),
});
```

If you need multiple relations between the same pair (rare), add a suffix: `slice(from,16) + slice(to,12) + "0001"`.

Without this, every rerun creates a brand-new relation entity and the user sees duplicates in the UI.

---

## Rule 11 — Normalize the Private Key

Users sometimes paste the private key without the `0x` prefix. Always normalize before use — the SDK throws a cryptic error without it:

```typescript
const raw = process.env.PRIVATE_KEY;
if (!raw) throw new Error("PRIVATE_KEY not set in .env");
const privateKey = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
```

Note: the official geo-publish skill uses `GEO_PRIVATE_KEY` as the env var name; our scripts use `PRIVATE_KEY`. Either works — just be consistent within a project.
