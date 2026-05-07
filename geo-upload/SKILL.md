---
name: geo-upload
description: Upload entities to a GEO Protocol space from a spreadsheet tab. Handles type proposals, relation vs text properties, existing entity reuse across spaces, location entities, and DAO publishing.
---

# GEO Protocol Entity Upload

Follow this workflow **exactly** when uploading entities from a spreadsheet tab to a GEO Protocol space.

---

## Step 0 — Wallet & Environment Setup

Before any upload, ensure the SDK environment is ready:

1. **Wallet**: Create a new wallet (e.g. Rabby), export the private key
2. **`.env` file**: Set `PRIVATE_KEY=0x...` (never commit this)
3. **Smart Account**: Use `getSmartAccountWalletClient({ privateKey })` — wraps your key in a Safe smart account. Gas is sponsored by GEO (no testnet ETH needed)
4. **Personal Space**: The smart account must have a personal space (create via https://www.geobrowser.io). This personal space ID becomes the `author`/`callerSpaceId` when publishing to DAO spaces
5. **Alternative (EOA)**: If using EOA wallet directly with `getWalletClient`, you need testnet ETH from faucet: `https://faucet.conduit.xyz/geo-test-zc16z3tcvf`

```typescript
import { getSmartAccountWalletClient } from "@geoprotocol/geo-sdk";
const walletClient = await getSmartAccountWalletClient({
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
});
```

**Export GEO wallet key**: If you already have a GEO account, export your private key at https://www.geobrowser.io/export-wallet

---

## Step 1 — Read the Type Proposal

Before writing any code, read the Type Proposal file for the entity type being uploaded. These files are named `GEO Type Proposal - <TypeName>.md` and live in the working directory.

The type proposal tells you:
- Every **property name**, its **data type** (Text, URL, Date, Integer, Relation), and for relations the **target type** (Topic, Organization, Legal Status, Person, etc.)

**This is critical.** If a property says `Type: Relation / Target: Topic`, you must use a relation — NOT `type: "text"` in values. GEO Protocol silently ignores text values passed to relation properties.

---

## Step 2 — Collect Property and Type IDs from the User

Ask the user for:
- The **type ID** for the entities being created
- The **property IDs** for every property on that type
- Any **spaces to search** for existing entities (e.g. Places space for locations)

Do NOT guess IDs. The user provides them.

### NEVER Guess Spaces — Always Ask (CRITICAL)

Types and properties can exist in **multiple spaces** with different configurations. **Never auto-select a space**, even if there's only one option. Always show the user:
- The **space name** and **space ID**
- The **property/type ID**

Let the user confirm which space's version to use.

```
TYPE SPACE SELECTION

  Type "Organization" exists in 3 spaces:

    1. AI Archaeology Explorer   (cf0e11338b33fcd6cdb032c625c85454)
    2. Root Space                (a19c345ab9866679b001d7d2138d88a1)
    3. Some Other Space          (abc123...)

  Which space's property set do you want to use? Enter number:
```

Same rule applies to property mapping — always show origin space and ID:

```
"Location" [RELATION → Place]
   id: 95d770021faf4f7cb7deb21a7d48cda0 | from: AI Archaeology Explorer
   → auto-matched to "Location". Accept? (y/n):
```

**This rule applies to everything:** types, properties, relation targets, existing entities. If there's any ambiguity about which space or which version — **ask the user, never guess**.

### Properties Are Shared Across Types Within a Space (CRITICAL)

A property in GEO is a **single global entity with one ID**. The same property ID is reused on every type that adopts it — there is no "Research challenge property on AI Tool" vs "Research challenge property on Discovery". Both types attach the **same** property ID (e.g. `c42bcc14d9684ab2a4f32513c974898b`) via their Properties relation.

**Practical implications:**
- Before creating a "new" property for a type, search the space for an existing property with the same name/semantic — reuse its ID. Never duplicate.
- A patch script targeting a property like "Research challenge" works for AI Tool, Discovery, or any other type that adopts it — one property ID, no per-type variants.
- When the user creates a property in the GEO UI for one type, that property ID can be attached to any other type without re-creating.
- Constraints (relation value type, data type) are set on the property entity itself — change once, applies to every type using it.

This is **distinct from** types/properties living in multiple spaces (covered below). One is "shared across types within a space"; the other is "shared across spaces".

### How Types & Properties Live Across Spaces (CRITICAL)

A type or property in GEO is a **single entity with one ID** that can appear in **multiple spaces simultaneously**. Its `spaceIds` field is an array.

**"Grabbing" a type from one space into another does not create a new entity.** It adds the grabber's space to the existing entity's `spaceIds` list. Same ID, now visible (and editable) in more than one space.

Concrete implications:
- A type created originally in Root Space can live in our space too, without a new ID
- Querying `entity(id: X) { spaceIds }` shows every space the type is visible in
- When multiple spaces see the same type, each space's DAO may have edit rights over it
- Our DAO can propose edits to a grabbed type, and those edits apply to the same entity everywhere — not just "in our space"
- **No retyping is needed** for existing entities when a type is grabbed — they're still typed as the same ID

This applies symmetrically to **properties**, which are also entities with their own `spaceIds`.

Practical consequence: when the user says "I grabbed the Quote type into our space", do **not** assume a new ID was created. Verify with:
```graphql
{ entity(id: "<TYPE_ID>") { spaceIds } }
```
If `spaceIds` contains our space, the grab happened by extending the array — no retype needed. Use the same type ID in all scripts.

Forking (creating a genuinely new local type with a different ID) is a **separate, heavier operation** and is rarely the right choice because it breaks all cross-space references that point at the original ID.

---

## Step 3 — Search for Existing Entities Before Creating

For every relation property, spreadsheet values are **names** (e.g. "Tokyo", "Academic institution"). You must resolve these to entity IDs.

**Search order:**
1. **Our working space** — query all entities via GQL
2. **Instructed spaces** — e.g. Places space `84a679ce188f061ac9a92380bac2bab5` for cities/countries
3. **Root space** — `08c4f09378584b7c9b94b82e448abcff`

**GQL pagination pattern:**
```graphql
{ entities(spaceId: "<ID>", first: 1000, offset: 0) { id name typeIds } }
```
Paginate with offset until `page.length < 1000`.

**Rules:**
- If an entity with matching name and type exists → **reuse its ID**
- If not → **create it** in our space with the correct type
- Never create duplicates

---

## Step 4 — ALL Relation Properties: Always Split on Commas

Comma-separated values in **any** relation column mean **multiple separate relations**. Always split and create one relation per value. This applies to Location, Topics, Affiliation — every relation property.

Examples:
- `"Tokyo, Japan"` → two relations (Tokyo + Japan)
- `"AI, Machine Learning, Computer Vision"` → three relations
- `"Academic institution"` → one relation (no comma)

```typescript
const vals = rawVal.split(",").map(s => s.trim()).filter(Boolean);
for (const val of vals) {
  const toId = await findOrCreate(val, ...);
  if (toId) { /* create relation */ }
}
```

### Check what types the relation accepts
Each relation property has `RELATION_VALUE_RELATIONSHIP_TYPE` (`9eea393f...`) relations that define what entity types it accepts (e.g. City, Country, Region, Topic, Organization). A single property can accept multiple types.

The spreadsheet value `"Tokyo, Japan, Asia"` becomes 3 relations — one per comma-separated part. Each part is resolved against the accepted types by searching loaded spaces. Don't hardcode assumptions about how many relations a property should have — follow the data.

### Known Place Type IDs (from Places space / ContentIds):
- City: `01b05333941a4b00bc78fac5a15b467d`
- Country: `42a0a7618c82459fad0834bfeb437cde`
- Continent: `3317d044a7004a9dbbaf4c16ade42f76`
- Region: `c188844a722442abb4762991c9c913f1`

---

## Step 5 — Use Inline Relations on createEntity

The SDK supports inline `relations` on `Graph.createEntity()` — use this for cleaner code instead of separate `Graph.createRelation()` calls:

```typescript
const { id, ops } = Graph.createEntity({
  name: "University of Kentucky",
  types: [ORGANIZATION_TYPE],
  values: [
    { property: DESCRIPTION_PROP, type: "text", value: "..." },
    { property: WEBSITE_PROP,     type: "text", value: "https://..." },
    { property: YEAR_FOUNDED_PROP, type: "text", value: "1865" },
  ],
  relations: {
    // Single relation
    [SECTOR_PROP]: { toEntity: sectorTopicId },
    // Multiple relations (array form)
    [LOCATION_PROP]: [
      { toEntity: cityId },
      { toEntity: countryId },
    ],
    // Multiple topics
    [TOPICS_PROP]: [
      { toEntity: topic1Id },
      { toEntity: topic2Id },
    ],
  },
});
```

If you need to add relations to **already-created** entities, use `Graph.createRelation()`:
```typescript
const { ops } = Graph.createRelation({
  fromEntity: entityId,
  toEntity: targetId,
  type: PROPERTY_ID,
});
```

---

## Step 6 — TypedValue Types (CRITICAL)

**Never assume a property is text.** Query the property's data type from GEO using the `VALUE_TYPE_RELATION_ID` (`6d29d57849bb4959baf72cc696b1671a`). Sending the wrong type silently fails — the value is ignored with no error.

| Type Proposal says | SDK type    | Example                              |
|--------------------|-------------|--------------------------------------|
| Text               | `"text"`    | `{ type: "text", value: "hello" }`   |
| URL                | `"text"`    | `{ type: "text", value: "https://"}` |
| Integer            | `"integer"` | `{ type: "integer", value: 1865 }`   |
| Float              | `"float"`   | `{ type: "float", value: 42.5 }`     |
| Boolean            | `"boolean"` | `{ type: "boolean", value: true }`   |
| Date               | `"date"`    | `{ type: "date", value: "2024-01-15" }` |
| Datetime           | `"datetime"`| `{ type: "datetime", value: "2024-01-15T00:00:00Z" }` |
| Point              | `"point"`   | `{ type: "point", lon: -122.4, lat: 37.7 }` |
| Relation           | Use `relations` param or `Graph.createRelation()` — NOT values |

### Datetime MUST be full RFC 3339
The SDK **rejects** bare dates like `"2024-01-15"` for datetime properties. Always append `T00:00:00Z`:
```typescript
// WRONG — throws "Invalid RFC 3339 datetime"
{ type: "datetime", value: "2024-01-15" }

// CORRECT
{ type: "datetime", value: "2024-01-15T00:00:00Z" }
```

### Property data type depends on who owns it
The data type is set by the **space that defines the property**:
- **Root Space properties** (e.g. `Date`, `Publish date`) — you cannot change their type. If they say Datetime, you must send RFC 3339.
- **Your space's properties** (e.g. `Year Founded`) — you control the type. If you set it as Text, just send `"1865"` as a string. No date parsing needed.

Always **query the actual data type from GEO** via `VALUE_TYPE_RELATION_ID`. Never assume — the same concept (a year, a date) can be Text in one space and Datetime in another.

Example: `Year Founded` on Organization = **Text** → `{ type: "text", value: "1865" }`
Example: `Date` from Root Space = **Datetime** → `{ type: "datetime", value: "2024-01-15T00:00:00Z" }`

### Display format vs data type
Properties can have a **format relation** (`2316bbe1c76f463583f23e03b4f1fe46`) that controls rendering (e.g. URL format). The data type is still Text — send `type: "text"`. The format only affects how GEO displays it.

### Coerce spreadsheet values
Spreadsheet cells come as strings. Coerce before sending:
- Integer: `parseInt(raw, 10)` — skip if `NaN`
- Float: `parseFloat(raw)` — skip if `NaN`
- Date/Datetime: normalize to ISO (`"1/15/2024"` → `"2024-01-15"`, year-only `"1865"` → `"1865-01-01"`)
- Boolean: `"true"/"yes"/"1"` → `true`

### ORCID and leading-zero IDs
Excel corrupts values like `0000-0002-1234-5678` (interprets as date/number, strips leading zeros). Read spreadsheets with `raw: false` to get formatted strings. Warn the user if mangled values are detected.

---

## Step 7 — Existing Entities: NEVER Guess, ALWAYS Ask (CRITICAL)

When an entity with the same name and type already exists in the space, **never decide silently**. Ask the user how to handle it. There are three possible actions:

1. **Fill gaps** — only add properties that are currently **empty** on the entity. Never touch existing data.
2. **Overwrite** — replace **all** properties with spreadsheet data. Old values are deleted and new ones added (e.g. improving a description).
3. **Skip** — ignore this entity entirely, do nothing.

The user can choose:
- A **global strategy** for all existing entities (e.g. "fill gaps for all")
- Or **per-entity** decisions (prompted for each one)

```
[5] University of Oxford
  → exists (a1b2c3d4...)
    How to handle this entity?
      1. Fill gaps  — only add empty properties
      2. Overwrite  — replace all properties with spreadsheet data
      3. Skip       — do nothing
      Enter number:
```

**Never overwrite without being told.** Never skip without being told. If no instruction is given about existing entities, **ask**.

---

## Step 8 — DAO Space Publishing Pattern

```typescript
// 1. Propose
const { editId, to, calldata, proposalId } = await daoSpace.proposeEdit({
  name: "Edit description",
  ops: allOps,
  author: CALLER_SPACE_ID,
  daoSpaceAddress: SPACE_ADDRESS,
  callerSpaceId: `0x${CALLER_SPACE}`,
  daoSpaceId: `0x${SPACE_ID}`,
  votingMode: "FAST",
  network: "TESTNET",
});

// 2. Vote YES
const { to: vTo, calldata: vCd } = daoSpace.voteProposal({
  authorSpaceId: CALLER_SPACE_ID,
  spaceId: SPACE_ID,
  proposalId,
  vote: "YES",
  network: "TESTNET",
});

// 3. Execute (try/catch — often auto-executes on vote)
try {
  const { to: eTo, calldata: eCd } = daoSpace.executeProposal({
    authorSpaceId: CALLER_SPACE_ID,
    spaceId: SPACE_ID,
    proposalId,
    network: "TESTNET",
  });
} catch { console.log("Auto-executed on vote"); }
```

2-second delay between each transaction.

---

## Step 9 — Skip Cover Images

Unless explicitly told otherwise, do NOT upload Cover Image columns. The user adds these manually.

---

## Step 10 — Review Before Running

Before running any upload script:
1. Print which entities will be created (name + generated ID)
2. Print which relations will be added (location, sector, topics, etc.)
3. Print which existing entities are being reused vs created new
4. Show total ops count
5. Wait for user confirmation

---

## Step 11 — Log Entity IDs

After upload, print all created entity IDs clearly:
```
"Entity Name": "entity_id_hex"
```
These are needed for future relation scripts.

---

## Common Relation Property Patterns

### Organization type:
- **Sector** → Relation → Target: Topic
- **Legal Status** → Relation → Target: Legal Status (its own type)
- **Location** → Relation → Target: City + Country (multiple relations)
- **Topics** → Relation → Target: Topic
- **Affiliation** → Relation → Target: Organization

### Researcher (Person) type:
- **Publications** → Relation → Target: Paper
- **Topics** → Relation → Target: Topic
- **Affiliation** → Relation → Target: Organization
- **Contributions** → Relation → Target: Project
- **Collaborators** → Relation → Target: Person
- **ORCID** → Text (numbers only, not URLs)
- **Academic Profile** → URL

### AI Tool type:
- **Developer** → Relation → Target: Organization
- **Key maintainers** → Relation → Target: Researcher
- **Research challenges** → Relation → Target: Research Challenge
- **First release** → Integer
- **Tool type** → Text
- **Website** → URL

### Discovery type:
- **Sources** → Relation → Target: Paper
- **Research challenge** → Relation → Target: Research Challenge
- **Discovery date** → Date
- **Supporting arguments** → Relation → Target: Claim
- **Opposing arguments** → Relation → Target: Claim
- **Related claims** → Relation → Target: Claim
- **Location** → Relation → Target: City / Country / Region

### Claim type (`96f859efa1ca4b229372c86ad58b694b`):
**ALL properties on Claim are Relations — never send text for any of them.**
- **Supporting arguments** (`1dc6a843458848198e7a6e672268f811`) → Relation → Target: Claim (sub-Claim entity)
- **Opposing arguments** (`4e6ec5d14292498a84e5f607ca1a08ce`) → Relation → Target: Claim (sub-Claim entity)
- **Quotes that support claims** (`f9eeaf9d9eb741b1ac5d257c6e82e526`) → Relation → Target: Quote
- **Sources** (`49c5d5e1679a4dbdbfd33f618f227c94`) → Relation → Target: Paper
- **Related people** (`5df8e4329cc54f038f854ac82e157ada`) → Relation → Target: Person
- **Topics** (`806d52bc27e94c9193c057978b093351`) → Relation → Target: Topic
- **Tags** (`257090341ba5406f94e4d4af90042fba`) → Relation → Target: Tag

**Sub-Claim pattern**: When the spreadsheet has Supporting/Opposing arguments as text, create a new Claim entity (name = first sentence, description = full text) and link it via the relation. Do NOT send the text as a value — GEO will silently ignore it.

**Quote type** (`043a171c69184dc3a7dbb8471ca6fcc2`): Name = the quote text itself. No text properties — everything else is Relations.
