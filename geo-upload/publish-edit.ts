import "dotenv/config";
import * as readline from "readline";
import XLSX from "xlsx";
import {
  Graph,
  personalSpace,
  daoSpace,
  getSmartAccountWalletClient,
} from "@geoprotocol/geo-sdk";

// ── CONFIGURATION ─────────────────────────────────────────────────────────────
const GEO_API = "https://testnet-api.geobrowser.io/graphql";

// ── GEO META-IDs ─────────────────────────────────────────────────────────────
const SCHEMA_TYPE_ID         = "e7d737c536764c609fa16aa64a8c90ad";
const PROPERTIES_RELATION_ID = "01412f8381894ab1836565c7fd358cc1";
const RELATION_VALUE_TYPE_ID = "9eea393f17dd4971a62ea603e8bfec20";
const VALUE_TYPE_RELATION_ID = "6d29d57849bb4959baf72cc696b1671a";
const NAME_PROPERTY_ID       = "a126ca530c8e48d5b88882c734c38935";
const DESCRIPTION_PROPERTY_ID= "9b1f76ff9711404c861e59dc3fa7d037";
const ROOT_SPACE             = "a19c345ab9866679b001d7d2138d88a1";

// ── INTERFACES ────────────────────────────────────────────────────────────────
interface GeoEntity {
  id: string;
  name: string | null;
  description: string | null;
  spaceIds: string[];
  typeIds: string[];
}

interface GeoProperty {
  id: string;
  name: string;
  isRelation: boolean;
  dataType: string;            // "text" | "date" | "integer" | "float" | "boolean" | "datetime" | "relation" | "url" | "point"
  expectedTypeId: string | null;
  expectedTypeName: string | null;
  spaceId: string;             // which space this property definition comes from
}

// ── DATA TYPE MAPPING ──────────────────────────────────────────────────────────
// Maps GEO data type entity names → SDK TypedValue type strings
const DATA_TYPE_MAP: Record<string, string> = {
  "text":     "text",
  "url":      "text",     // URLs are stored as text values in the SDK
  "date":     "date",
  "datetime": "datetime",
  "integer":  "integer",
  "float":    "float",
  "boolean":  "boolean",
  "point":    "point",
  "relation": "relation", // handled separately via Graph.createRelation
};

function resolveDataType(dataTypeName: string | null): string {
  if (!dataTypeName) return "text";
  const key = dataTypeName.toLowerCase().trim();
  return DATA_TYPE_MAP[key] ?? "text";
}

type PropertyMapping = Map<string, string | null>;

interface SpaceConfig {
  targetSpace: string;
  callerSpace: string | null;       // for DAO spaces
  daoSpaceAddress: string | null;   // for DAO spaces
  isDao: boolean;
  extraSpaces: Array<{ id: string; label: string }>;
}

// ── CLI HELPER ────────────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, answer => resolve(answer.trim())));
}

function closeInput() { rl.close(); }

// ── GEO API HELPER ────────────────────────────────────────────────────────────
async function gql(query: string): Promise<any> {
  const res = await fetch(GEO_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return (await res.json() as any).data;
}

// ── LOAD ALL ENTITIES FROM A SPACE (paginated) ────────────────────────────────
async function loadSpace(spaceId: string, label: string): Promise<GeoEntity[]> {
  const all: GeoEntity[] = [];
  const PAGE = 1000;
  let offset = 0;
  process.stdout.write(`Loading ${label}...`);
  while (true) {
    const data = await gql(`{
      entities(spaceId: "${spaceId}", first: ${PAGE}, offset: ${offset}) {
        id name description spaceIds typeIds
      }
    }`);
    const page: GeoEntity[] = data?.entities ?? [];
    all.push(...page);
    offset += PAGE;
    if (page.length < PAGE) break;
  }
  console.log(` ${all.length} entities`);
  return all;
}

// ── BUILD INDEXES ─────────────────────────────────────────────────────────────
function byName(entities: GeoEntity[]): Map<string, GeoEntity[]> {
  const map = new Map<string, GeoEntity[]>();
  for (const e of entities) {
    if (!e.name) continue;
    const key = e.name.toLowerCase().trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return map;
}

// ── INTERACTIVE SETUP ─────────────────────────────────────────────────────────
async function interactiveSetup(): Promise<{
  config: SpaceConfig;
  typeId: string;
  excelPath: string;
  sheetName: string;
  batchOffset: number;
  batchLimit: number;
  nameColumn: string;
}> {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  GEO PROTOCOL — UNIVERSAL UPLOAD ENGINE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Target space
  const targetSpace = await ask("  Target space ID: ");
  if (!targetSpace) throw new Error("Target space is required.");

  // DAO or personal?
  const daoChoice = await ask("  Is this a DAO space? (y/n): ");
  const isDao = daoChoice.toLowerCase() === "y";
  let callerSpace: string | null = null;
  let daoSpaceAddress: string | null = null;

  if (isDao) {
    callerSpace = await ask("  Caller (author) space ID: ");
    daoSpaceAddress = await ask("  DAO space contract address (0x...): ");
    if (!callerSpace || !daoSpaceAddress) throw new Error("Caller space and DAO address required for DAO spaces.");
  }

  // Extra spaces for entity lookup
  const extraSpaces: Array<{ id: string; label: string }> = [];
  console.log("\n  Additional spaces to search for existing entities?");
  console.log("  (e.g. Places space for cities/countries)");
  while (true) {
    const extraId = await ask("  Space ID (or Enter to skip): ");
    if (!extraId) break;
    const extraLabel = await ask("  Label for this space: ");
    extraSpaces.push({ id: extraId, label: extraLabel || extraId });
    console.log(`  Added: ${extraLabel || extraId} (${extraId})`);
  }

  // Type ID
  const typeId = await ask("\n  Type ID to upload: ");
  if (!typeId) throw new Error("Type ID is required.");

  // Excel file
  const excelPath = await ask("  Excel file path: ");
  if (!excelPath) throw new Error("Excel path is required.");

  const sheetName = await ask("  Sheet name: ");
  if (!sheetName) throw new Error("Sheet name is required.");

  // Name column
  const nameColumn = await ask("  Name column in spreadsheet (default: 'Name'): ") || "Name";

  // Batch control
  const offsetStr = await ask("  Batch offset (default: 0): ");
  const limitStr  = await ask("  Batch limit (default: all): ");
  const batchOffset = parseInt(offsetStr) || 0;
  const batchLimit  = parseInt(limitStr)  || 999999;

  console.log();
  return {
    config: { targetSpace, callerSpace, daoSpaceAddress, isDao, extraSpaces },
    typeId,
    excelPath,
    sheetName,
    batchOffset,
    batchLimit,
    nameColumn,
  };
}

// ── PICK WHICH SPACE'S VERSION OF A TYPE TO USE ───────────────────────────────
async function pickTypeSpace(typeId: string): Promise<string> {
  const data = await gql(`{
    entity(id: "${typeId}") {
      name
      spaceIds
    }
  }`);

  const typeName  = data?.entity?.name ?? typeId;
  const spaceIds: string[] = data?.entity?.spaceIds ?? [];

  if (spaceIds.length === 0) throw new Error(`Type "${typeName}" not found in any space.`);

  // Resolve space names for ALL cases (even single space)
  const spacesData = await gql(`{
    spaces(filter: { id: { in: [${spaceIds.map(id => `"${id}"`).join(", ")}] } }) {
      id
      page { name }
    }
  }`);
  const spaceNames = new Map<string, string>();
  for (const s of spacesData?.spaces ?? []) {
    spaceNames.set(s.id, s.page?.name ?? s.id);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  TYPE SPACE SELECTION");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`\n  Type "${typeName}" exists in ${spaceIds.length} space(s):\n`);
  spaceIds.forEach((id, i) => {
    const label = spaceNames.get(id) ?? id;
    console.log(`    ${i + 1}. ${label.padEnd(20)} (${id})`);
  });
  console.log();

  let choice = -1;
  while (choice < 1 || choice > spaceIds.length) {
    const input = await ask(`  Which space's property set do you want to use? Enter number: `);
    choice = parseInt(input);
    if (isNaN(choice) || choice < 1 || choice > spaceIds.length) {
      console.log(`  Please enter a number between 1 and ${spaceIds.length}.`);
      choice = -1;
    }
  }

  const chosen = spaceIds[choice - 1];
  console.log(`\n  ✅ Using "${spaceNames.get(chosen) ?? chosen}" property set\n`);
  return chosen;
}

// ── SPACE NAME CACHE ─────────────────────────────────────────────────────────
const spaceNameCache = new Map<string, string>();

async function resolveSpaceName(spaceId: string): Promise<string> {
  if (spaceNameCache.has(spaceId)) return spaceNameCache.get(spaceId)!;
  try {
    const data = await gql(`{ space(id: "${spaceId}") { name } }`);
    const name = data?.space?.name ?? spaceId;
    spaceNameCache.set(spaceId, name);
    return name;
  } catch {
    spaceNameCache.set(spaceId, spaceId);
    return spaceId;
  }
}

// ── GET PROPERTIES OF A TYPE (filtered by space) ──────────────────────────────
const propCache = new Map<string, GeoProperty[]>();

async function getTypeProperties(typeId: string, spaceId: string): Promise<GeoProperty[]> {
  const cacheKey = `${typeId}::${spaceId}`;
  if (propCache.has(cacheKey)) return propCache.get(cacheKey)!;

  const data = await gql(`{
    entity(id: "${typeId}") {
      relationsList {
        typeId
        spaceId
        toEntity { id name spaceIds
          relationsList(filter: { typeId: { in: ["${RELATION_VALUE_TYPE_ID}", "${VALUE_TYPE_RELATION_ID}"] } }) {
            typeId
            toEntity { id name }
          }
        }
      }
    }
  }`);

  const props: GeoProperty[] = [];
  for (const rel of data?.entity?.relationsList ?? []) {
    if (rel.typeId !== PROPERTIES_RELATION_ID) continue;
    if (rel.spaceId !== spaceId) continue;
    const pe = rel.toEntity;
    if (!pe?.name) continue;
    const subRels: any[] = pe.relationsList ?? [];
    const dataTypeRel  = subRels.find((r: any) => r.typeId === VALUE_TYPE_RELATION_ID);
    const valueTypeRel = subRels.find((r: any) => r.typeId === RELATION_VALUE_TYPE_ID);
    const rawDataType  = dataTypeRel?.toEntity?.name ?? null;
    const dataType     = resolveDataType(rawDataType);
    const isRelation   = dataType === "relation" || !!valueTypeRel;
    props.push({
      id: pe.id,
      name: pe.name,
      isRelation,
      dataType,
      expectedTypeId:   valueTypeRel?.toEntity?.id   ?? null,
      expectedTypeName: valueTypeRel?.toEntity?.name ?? null,
      spaceId:          rel.spaceId,
    });
  }

  propCache.set(cacheKey, props);
  return props;
}

// ── INTERACTIVE MAPPING BUILDER ───────────────────────────────────────────────
async function buildMapping(
  geoProps: GeoProperty[],
  docColumns: string[]
): Promise<PropertyMapping> {
  const mapping: PropertyMapping = new Map();
  const usedDocCols = new Set<string>();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  PROPERTY MAPPING");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  for (const geoprop of geoProps) {
    const kind = geoprop.isRelation
      ? (geoprop.expectedTypeName ? `RELATION → ${geoprop.expectedTypeName}` : "RELATION (untyped)")
      : geoprop.dataType.toUpperCase();
    const spaceName = spaceNameCache.get(geoprop.spaceId) ?? geoprop.spaceId;
    const propInfo = `id: ${geoprop.id} | from: ${spaceName}`;

    // Try auto-match: exact name (case-insensitive, trimmed)
    const autoMatch = docColumns.find(
      col => col.trim().toLowerCase() === geoprop.name.toLowerCase()
    );

    if (autoMatch && !usedDocCols.has(autoMatch)) {
      // Auto-match found — but still confirm with user
      console.log(`  "${geoprop.name}" [${kind}]`);
      console.log(`     ${propInfo}`);
      const confirmAuto = await ask(
        `     → auto-matched to "${autoMatch}". Accept? (y/n): `
      );
      if (confirmAuto.toLowerCase() === "y") {
        mapping.set(geoprop.name, autoMatch);
        usedDocCols.add(autoMatch);
        console.log(`     ✅ Confirmed\n`);
        continue;
      }
      // User rejected auto-match — fall through to manual selection
      console.log(`     → Rejected auto-match, selecting manually...\n`);
    }

    // No auto-match or rejected — ask the user
    console.log(`  ⚠️  "${geoprop.name}" [${kind}]`);
    console.log(`     ${propInfo}`);
    if (!autoMatch) console.log(`     No matching column found.\n`);

    const available = docColumns.filter(col => !usedDocCols.has(col));

    console.log(`     Available document columns:`);
    available.forEach((col, i) => console.log(`       ${i + 1}. "${col}"`));
    console.log(`       ${available.length + 1}. Skip this property (leave unfilled)`);

    let choice = -1;
    while (choice < 1 || choice > available.length + 1) {
      const input = await ask(`\n     Which column maps to "${geoprop.name}"? Enter number: `);
      choice = parseInt(input);
      if (isNaN(choice) || choice < 1 || choice > available.length + 1) {
        console.log(`     Please enter a number between 1 and ${available.length + 1}.`);
        choice = -1;
      }
    }

    if (choice === available.length + 1) {
      mapping.set(geoprop.name, null);
      console.log(`     → Skipped\n`);
    } else {
      const chosen = available[choice - 1];
      mapping.set(geoprop.name, chosen);
      usedDocCols.add(chosen);
      console.log(`     → Mapped to "${chosen}"\n`);
    }
  }

  // Warn about document columns not mapped
  const unmappedDocCols = docColumns.filter(col => !usedDocCols.has(col));
  if (unmappedDocCols.length > 0) {
    console.log(`  ℹ️  Document columns with no GEO property match (will be ignored):`);
    unmappedDocCols.forEach(col => console.log(`     - "${col}"`));
    console.log();
  }

  // Full mapping summary
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  MAPPING SUMMARY");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  for (const [geoProp, docCol] of mapping) {
    const prop = geoProps.find(p => p.name === geoProp);
    const kind = prop?.isRelation
      ? (prop.expectedTypeName ? `[REL→${prop.expectedTypeName}]` : "[REL]")
      : `[${(prop?.dataType ?? "text").toUpperCase()}]`;
    const status = docCol ? `→ "${docCol}"` : "→ skipped";
    const origin = prop ? (spaceNameCache.get(prop.spaceId) ?? prop.spaceId) : "?";
    console.log(`  ${geoProp.padEnd(25)} ${kind.padEnd(20)} ${status}`);
    console.log(`  ${"".padEnd(25)} id: ${prop?.id ?? "?"}  from: ${origin}`);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Final confirmation
  const confirm = await ask("  Proceed with this mapping? (y/n): ");
  if (confirm.toLowerCase() !== "y") {
    console.log("\n  Upload cancelled.");
    closeInput();
    process.exit(0);
  }

  console.log();
  return mapping;
}

// ── FIND ENTITY BY NAME + TYPE (searches all loaded indexes) ────────────────
function findEntity(
  name: string,
  typeId: string,
  indexes: Map<string, GeoEntity[]>[]
): GeoEntity | null {
  const key = name.toLowerCase().trim();
  for (const idx of indexes) {
    const match = (idx.get(key) ?? []).find(e => e.typeIds.includes(typeId));
    if (match) return match;
  }
  return null;
}

function findEntityByName(
  name: string,
  indexes: Map<string, GeoEntity[]>[]
): GeoEntity | null {
  const key = name.toLowerCase().trim();
  for (const idx of indexes) {
    const candidates = idx.get(key) ?? [];
    if (candidates.length > 0) return candidates[0];
  }
  return null;
}

// ── FIND-OR-CREATE FOR RELATION TARGETS ─────────────────────────────────────
// When not found and auto-create is uncertain, asks the user
async function findOrCreate(
  name: string,
  prop: GeoProperty,
  indexes: Map<string, GeoEntity[]>[],
  targetIdx: Map<string, GeoEntity[]>,
  targetSpace: string,
  idMap: Map<string, string>,
  allOps: any[]
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const mapKey = `${prop.expectedTypeId}::${trimmed.toLowerCase()}`;
  if (idMap.has(mapKey)) return idMap.get(mapKey)!;

  // Untyped relation or generic meta-type: search by name only, never auto-create
  if (!prop.expectedTypeId || prop.expectedTypeId === SCHEMA_TYPE_ID) {
    const existing = findEntityByName(trimmed, indexes);
    if (existing) { idMap.set(mapKey, existing.id); return existing.id; }
    console.warn(`    ⚠ "${trimmed}" not found for "${prop.name}" (untyped relation — skipping)`);
    return null;
  }

  // Typed relation: find by name + expected type across ALL loaded spaces
  const existing = findEntity(trimmed, prop.expectedTypeId!, indexes);
  if (existing) { idMap.set(mapKey, existing.id); return existing.id; }

  // Not found anywhere — ask user before creating
  console.log(`    ⚠ "${trimmed}" not found as ${prop.expectedTypeName ?? "entity"} in any loaded space.`);
  const action = await ask(`      Create it now? (y = create / n = skip): `);

  if (action.toLowerCase() !== "y") {
    console.log(`      → Skipped`);
    return null;
  }

  console.log(`    + Creating "${trimmed}" as ${prop.expectedTypeName ?? "entity"}`);
  const e = Graph.createEntity({
    name: trimmed,
    types: [prop.expectedTypeId!],
    values: [{ property: NAME_PROPERTY_ID, type: "text", value: trimmed }],
  });
  allOps.push(...e.ops);
  idMap.set(mapKey, e.id);

  const key = trimmed.toLowerCase();
  if (!targetIdx.has(key)) targetIdx.set(key, []);
  targetIdx.get(key)!.push({
    id: e.id, name: trimmed, description: null,
    spaceIds: [targetSpace], typeIds: [prop.expectedTypeId!],
  });

  return e.id;
}

// ── GET CURRENT DATA OF AN EXISTING ENTITY (for patch mode) ──────────────────
interface EntityCurrentData {
  filledTextProps: Set<string>;
  filledRelations: Map<string, Set<string>>;
}

async function getEntityCurrentData(entityId: string): Promise<EntityCurrentData> {
  const data = await gql(`{
    entity(id: "${entityId}") {
      valuesList  { propertyId text }
      relationsList { typeId toEntity { id } }
    }
  }`);
  const filledTextProps = new Set<string>();
  for (const v of data?.entity?.valuesList ?? []) {
    if (v.text) filledTextProps.add(v.propertyId);
  }
  const filledRelations = new Map<string, Set<string>>();
  for (const r of data?.entity?.relationsList ?? []) {
    if (!filledRelations.has(r.typeId)) filledRelations.set(r.typeId, new Set());
    if (r.toEntity?.id) filledRelations.get(r.typeId)!.add(r.toEntity.id);
  }
  return { filledTextProps, filledRelations };
}

// ── DAO PUBLISH HELPERS ──────────────────────────────────────────────────────
async function sendTx(walletClient: any, to: `0x${string}`, calldata: `0x${string}`, label: string) {
  const txHash = await walletClient.sendTransaction({ to, data: calldata });
  console.log(`  ✓ ${label} → ${txHash}`);
  await new Promise(r => setTimeout(r, 2000));
}

async function publishDao(
  walletClient: any,
  ops: any[],
  name: string,
  callerSpace: string,
  daoSpaceAddress: string,
  targetSpace: string
) {
  const callerHex = `0x${callerSpace}` as `0x${string}`;
  const targetHex = `0x${targetSpace}` as `0x${string}`;
  const addrHex   = daoSpaceAddress as `0x${string}`;

  const { editId, to: pTo, calldata: pCd, proposalId } = await daoSpace.proposeEdit({
    name, ops, author: callerSpace,
    daoSpaceAddress: addrHex,
    callerSpaceId: callerHex,
    daoSpaceId: targetHex,
    votingMode: "FAST", network: "TESTNET",
  });
  console.log(`  Edit: ${editId}  Proposal: ${proposalId}`);
  await sendTx(walletClient, pTo, pCd, "Propose");

  const { to: vTo, calldata: vCd } = daoSpace.voteProposal({
    authorSpaceId: callerSpace, spaceId: targetSpace, proposalId, vote: "YES", network: "TESTNET",
  });
  await sendTx(walletClient, vTo, vCd, "Vote YES");

  try {
    const { to: eTo, calldata: eCd } = daoSpace.executeProposal({
      authorSpaceId: callerSpace, spaceId: targetSpace, proposalId, network: "TESTNET",
    });
    await sendTx(walletClient, eTo, eCd, "Execute");
  } catch { console.log("  (Auto-executed on vote)"); }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  if (!privateKey?.startsWith("0x")) throw new Error("Invalid PRIVATE_KEY in .env");

  // ── 0. INTERACTIVE SETUP ──────────────────────────────────────────────────
  const {
    config, typeId, excelPath, sheetName,
    batchOffset, batchLimit, nameColumn
  } = await interactiveSetup();

  // ── 1. LOAD ALL SPACES ────────────────────────────────────────────────────
  const targetEntities = await loadSpace(config.targetSpace, "target space");
  const rootEntities   = await loadSpace(ROOT_SPACE, "root space");
  const targetIdx = byName(targetEntities);
  const rootIdx   = byName(rootEntities);

  // All indexes: target, root, + extra spaces
  const allIndexes: Map<string, GeoEntity[]>[] = [targetIdx, rootIdx];
  for (const extra of config.extraSpaces) {
    const extraEntities = await loadSpace(extra.id, extra.label);
    allIndexes.push(byName(extraEntities));
  }

  // ── 2. PICK SPACE VERSION OF TYPE + LOAD PROPERTIES ──────────────────────
  const typeSpaceId = await pickTypeSpace(typeId);
  console.log("Resolving type properties from GEO...");
  const geoProps = await getTypeProperties(typeId, typeSpaceId);
  if (geoProps.length === 0) throw new Error("Type has no properties defined in GEO for the selected space.");

  console.log(`  Found ${geoProps.length} properties on type:\n`);
  // Resolve space names for all properties
  const propSpaceIds = [...new Set(geoProps.map(p => p.spaceId))];
  for (const sid of propSpaceIds) await resolveSpaceName(sid);

  for (const p of geoProps) {
    const kind = p.isRelation
      ? (p.expectedTypeName ? `RELATION → ${p.expectedTypeName}` : "RELATION (untyped)")
      : p.dataType.toUpperCase();
    const spaceName = spaceNameCache.get(p.spaceId) ?? p.spaceId;
    console.log(`    ${p.name.padEnd(25)} [${kind.padEnd(20)}]  id: ${p.id}  from: ${spaceName}`);
  }

  // ── 3. READ DOCUMENT ───────────────────────────────────────────────────────
  console.log("\nReading document...");
  const wb = XLSX.readFile(excelPath);
  // raw: false → formatted strings (preserves display values for dates/ORCIDs)
  const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[sheetName], { raw: false, defval: "" });
  // raw: true → raw values (to detect Excel mangling of leading zeros)
  const rawRows = XLSX.utils.sheet_to_json<any>(wb.Sheets[sheetName], { raw: true, defval: "" });
  const batch = rows.slice(batchOffset, batchOffset + batchLimit);
  const rawBatch = rawRows.slice(batchOffset, batchOffset + batchLimit);

  const docColumns = Object.keys(rows[0] ?? {}).filter(col =>
    col !== nameColumn && col !== "Type"
  );
  console.log(`  ${rows.length} rows | ${docColumns.length} property columns | batch: ${batchOffset + 1}–${batchOffset + batch.length}`);

  // Data integrity check: warn about values that look mangled by Excel
  let integrityWarnings = 0;
  for (let i = 0; i < batch.length; i++) {
    const name = (batch[i][nameColumn] as string)?.trim() ?? `Row ${i + 1}`;
    for (const col of docColumns) {
      const formatted = (batch[i][col] ?? "").toString().trim();
      const raw = (rawBatch[i]?.[col] ?? "").toString().trim();
      if (!formatted) continue;

      // Detect ORCID-like values that Excel might have mangled:
      // If raw value is a number but formatted shows a date-like pattern, warn
      if (typeof rawBatch[i]?.[col] === "number" && /[-\/]/.test(formatted) && formatted.length < 12) {
        console.warn(`  ⚠ POSSIBLE EXCEL MANGLING: ${name} → "${col}" = "${formatted}" (raw: ${raw})`);
        console.warn(`    This might be an ID/code that Excel converted to a date or number.`);
        integrityWarnings++;
      }
    }
  }
  if (integrityWarnings > 0) {
    console.warn(`\n  ⚠ ${integrityWarnings} possible data integrity issue(s) detected above.`);
    console.warn(`    Check your spreadsheet — cells with IDs/codes should be formatted as "Text" in Excel.\n`);
    const continueChoice = await ask("  Continue anyway? (y/n): ");
    if (continueChoice.toLowerCase() !== "y") {
      console.log("\n  Upload cancelled. Fix the spreadsheet and retry.");
      closeInput();
      process.exit(0);
    }
  }

  // ── 4. INTERACTIVE MAPPING ─────────────────────────────────────────────────
  const mapping = await buildMapping(geoProps, docColumns);

  // ── 5. RELATION MULTI-VALUE ─────────────────────────────────────────────────
  // All relation properties automatically split on commas.
  // "Tokyo, Japan" → two separate relations (Tokyo + Japan)
  // "Academic institution" → one relation (no comma, no split)
  console.log("  ℹ️  All relation properties will split comma-separated values into separate relations.\n");

  // ── 6. DRY RUN PREVIEW + EXISTING ENTITY STRATEGY ──────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  DRY RUN PREVIEW");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  let previewNew = 0;
  let previewExist = 0;
  for (const row of batch) {
    const name = (row[nameColumn] as string)?.trim();
    if (!name) continue;
    const exists = findEntity(name, typeId, allIndexes);
    if (exists) {
      console.log(`  [EXISTS] ${name} (${exists.id})`);
      previewExist++;
    } else {
      console.log(`  [NEW]    ${name}`);
      previewNew++;
    }
  }
  console.log(`\n  New: ${previewNew} | Existing: ${previewExist} | Total: ${previewNew + previewExist}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Ask how to handle existing entities (if any)
  // "fill"      = only add properties that are currently empty, never overwrite
  // "overwrite" = replace all properties with spreadsheet data (delete old + add new)
  // "ask"       = ask per entity what to do
  // "skip"      = ignore all existing entities entirely
  type ExistingStrategy = "fill" | "overwrite" | "ask" | "skip";
  let existingStrategy: ExistingStrategy = "ask";

  if (previewExist > 0) {
    console.log("  How should EXISTING entities be handled?\n");
    console.log("    1. Fill gaps     — only add properties that are currently EMPTY (never overwrite)");
    console.log("    2. Overwrite     — replace ALL properties with spreadsheet data");
    console.log("    3. Ask per entity — prompt me for EACH existing entity");
    console.log("    4. Skip all      — ignore all existing entities, only create new ones\n");

    let stratChoice = -1;
    while (stratChoice < 1 || stratChoice > 4) {
      const input = await ask("  Enter number: ");
      stratChoice = parseInt(input);
      if (isNaN(stratChoice) || stratChoice < 1 || stratChoice > 4) {
        console.log("  Please enter 1, 2, 3, or 4.");
        stratChoice = -1;
      }
    }
    existingStrategy = (["fill", "overwrite", "ask", "skip"] as const)[stratChoice - 1];
    console.log(`\n  → Strategy: ${existingStrategy}\n`);
  }

  const proceed = await ask("  Proceed with upload? (y/n): ");
  if (proceed.toLowerCase() !== "y") {
    console.log("\n  Upload cancelled.");
    closeInput();
    process.exit(0);
  }

  // ── 7. PROCESS ENTITIES ────────────────────────────────────────────────────
  console.log(`\nProcessing ${batch.length} entities...\n`);

  const allOps: any[] = [];
  const idMap = new Map<string, string>();
  let newCount = 0;
  let patchedCount = 0;

  for (let i = 0; i < batch.length; i++) {
    const row = batch[i];
    const name = (row[nameColumn] as string)?.trim();
    if (!name) continue;

    console.log(`[${batchOffset + i + 1}] ${name}`);

    const existing = findEntity(name, typeId, allIndexes);

    if (existing) {
      // ── EXISTING ENTITY ───────────────────────────────────────────────────
      console.log(`  → exists (${existing.id})`);

      // Determine action for this entity
      let action: "fill" | "overwrite" | "skip" = existingStrategy as any;

      if (existingStrategy === "ask") {
        console.log(`    How to handle this entity?`);
        console.log(`      1. Fill gaps  — only add empty properties`);
        console.log(`      2. Overwrite  — replace all properties with spreadsheet data`);
        console.log(`      3. Skip       — do nothing`);
        let c = -1;
        while (c < 1 || c > 3) {
          const input = await ask(`      Enter number: `);
          c = parseInt(input);
          if (isNaN(c) || c < 1 || c > 3) { console.log(`      Please enter 1, 2, or 3.`); c = -1; }
        }
        action = (["fill", "overwrite", "skip"] as const)[c - 1];
      }

      if (action === "skip") {
        console.log(`    → Skipped\n`);
        continue;
      }

      console.log(`    → Action: ${action}`);
      const current = await getEntityCurrentData(existing.id);
      const valuesToSet: any[] = [];
      const propsToUnset: any[] = [];

      for (const geoprop of geoProps) {
        const docCol = mapping.get(geoprop.name);
        if (!docCol) continue;
        const rawVal = (row[docCol] ?? "").toString().trim();

        if (!geoprop.isRelation) {
          const hasCurrent = current.filledTextProps.has(geoprop.id);

          if (action === "fill") {
            // Only add if property is currently empty
            if (!hasCurrent && rawVal) {
              const coerced = coerceValue(rawVal, geoprop.dataType);
              if (coerced !== null) {
                valuesToSet.push({ property: geoprop.id, ...coerced });
                console.log(`    + ${geoprop.dataType}: ${geoprop.name} = "${rawVal.substring(0, 50)}"`);
              }
            } else if (hasCurrent) {
              console.log(`    = ${geoprop.name} already has data — keeping existing`);
            }
          } else if (action === "overwrite") {
            // Replace with spreadsheet data; if spreadsheet is empty, unset
            if (rawVal) {
              const coerced = coerceValue(rawVal, geoprop.dataType);
              if (coerced !== null) {
                valuesToSet.push({ property: geoprop.id, ...coerced });
                console.log(`    ↻ ${geoprop.dataType}: ${geoprop.name} = "${rawVal.substring(0, 50)}"`);
              }
            } else if (hasCurrent) {
              propsToUnset.push({ property: geoprop.id });
              console.log(`    ✕ ${geoprop.name} — clearing (spreadsheet is empty)`);
            }
          }
        } else {
          if (!rawVal) continue;
          const existingLinks = current.filledRelations.get(geoprop.id) ?? new Set();
          const vals = splitVal(rawVal);
          for (const val of vals) {
            const toId = await findOrCreate(val, geoprop, allIndexes, targetIdx, config.targetSpace, idMap, allOps);
            if (!toId || existingLinks.has(toId)) continue;
            const r = Graph.createRelation({ fromEntity: existing.id, toEntity: toId, type: geoprop.id });
            allOps.push(...r.ops);
            console.log(`    + rel: ${geoprop.name} → "${val}"`);
          }
        }
      }

      if (valuesToSet.length > 0) {
        const update = Graph.updateEntity({ id: existing.id, values: valuesToSet });
        allOps.push(...update.ops);
      }
      if (propsToUnset.length > 0) {
        const unsetOp = Graph.updateEntity({ id: existing.id, unset: propsToUnset });
        allOps.push(...unsetOp.ops);
      }
      patchedCount++;

    } else {
      // ── CREATE ─────────────────────────────────────────────────────────────
      console.log(`  → new entity`);
      const typedValues: any[] = [{ property: NAME_PROPERTY_ID, type: "text", value: name }];

      for (const geoprop of geoProps) {
        if (geoprop.isRelation) continue;
        const docCol = mapping.get(geoprop.name);
        if (!docCol) continue;
        const rawVal = (row[docCol] ?? "").toString().trim();
        if (!rawVal) continue;
        const coerced = coerceValue(rawVal, geoprop.dataType);
        if (coerced !== null) typedValues.push({ property: geoprop.id, ...coerced });
      }

      const entity = Graph.createEntity({
        name,
        types: [typeId],
        values: typedValues,
      });
      allOps.push(...entity.ops);

      const key = name.toLowerCase();
      if (!targetIdx.has(key)) targetIdx.set(key, []);
      targetIdx.get(key)!.push({
        id: entity.id, name, description: null,
        spaceIds: [config.targetSpace], typeIds: [typeId],
      });

      for (const geoprop of geoProps) {
        if (!geoprop.isRelation) continue;
        const docCol = mapping.get(geoprop.name);
        if (!docCol) continue;
        const rawVal = (row[docCol] ?? "").toString().trim();
        if (!rawVal) continue;

        const vals = splitVal(rawVal);
        for (const val of vals) {
          const toId = await findOrCreate(val, geoprop, allIndexes, targetIdx, config.targetSpace, idMap, allOps);
          if (!toId) continue;
          const r = Graph.createRelation({ fromEntity: entity.id, toEntity: toId, type: geoprop.id });
          allOps.push(...r.ops);
        }
      }

      newCount++;
    }
  }

  closeInput();
  console.log(`\nSummary: ${newCount} new | ${patchedCount} patched`);

  if (allOps.length === 0) {
    console.log("✓ Nothing new to upload.");
    return;
  }

  // ── 8. PUBLISH ─────────────────────────────────────────────────────────────
  console.log(`\nTotal ops: ${allOps.length}`);

  const walletClient = await getSmartAccountWalletClient({ privateKey });

  if (config.isDao && config.callerSpace && config.daoSpaceAddress) {
    console.log("Publishing via DAO proposal...");
    await publishDao(
      walletClient, allOps,
      `Upload batch ${batchOffset + 1}–${batchOffset + batch.length}`,
      config.callerSpace, config.daoSpaceAddress, config.targetSpace
    );
  } else {
    console.log("Publishing to personal space...");
    const { editId, to, calldata } = await personalSpace.publishEdit({
      name: `Batch ${batchOffset + 1}–${batchOffset + batchLimit}`,
      spaceId: config.targetSpace,
      ops: allOps,
      author: config.targetSpace,
      network: "TESTNET",
    });
    const txHash = await walletClient.sendTransaction({ to, data: calldata });
    console.log(`  Edit ID: ${editId}`);
    console.log(`  Tx Hash: ${txHash}`);
  }

  console.log(`\n✓ Done!`);
  console.log(`  View: https://geobrowser.io/space/${config.targetSpace}`);
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function splitVal(val: unknown): string[] {
  if (!val || typeof val !== "string") return [];
  return val.split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * Normalizes various date formats into ISO "YYYY-MM-DD".
 * Handles: "2024-01-15", "01/15/2024", "1/15/2024", "January 15, 2024",
 *          "15-Jan-24", "15 Jan 2024", Excel serial numbers, etc.
 * Returns null if unparseable.
 */
function normalizeDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();

  // Already ISO format: "2024-01-15" or "2024-01-15T..."
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.substring(0, 10);
  }

  // Excel serial number (a plain number like 45307)
  if (/^\d{5}$/.test(trimmed)) {
    const serial = parseInt(trimmed, 10);
    // Excel epoch: Jan 1, 1900 = serial 1 (with the leap year bug offset)
    const ms = (serial - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
  }

  // Year only: "1865", "2024"
  if (/^\d{4}$/.test(trimmed)) {
    return `${trimmed}-01-01`;
  }

  // Try native Date parsing as fallback (handles most text formats)
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().substring(0, 10);
  }

  return null;
}

/**
 * Coerces a raw string value from the spreadsheet into the correct SDK typed value format.
 * Returns null if the value cannot be coerced (e.g. non-numeric string for integer).
 */
function coerceValue(raw: string, dataType: string): { type: string; value: any; lon?: number; lat?: number } | null {
  switch (dataType) {
    case "text":
      return { type: "text", value: raw };

    case "integer": {
      const n = parseInt(raw, 10);
      if (isNaN(n)) { console.warn(`      ⚠ "${raw}" is not a valid integer — skipping`); return null; }
      return { type: "integer", value: n };
    }

    case "float": {
      const f = parseFloat(raw);
      if (isNaN(f)) { console.warn(`      ⚠ "${raw}" is not a valid float — skipping`); return null; }
      return { type: "float", value: f };
    }

    case "boolean": {
      const lower = raw.toLowerCase();
      if (["true", "yes", "1"].includes(lower)) return { type: "boolean", value: true };
      if (["false", "no", "0"].includes(lower)) return { type: "boolean", value: false };
      console.warn(`      ⚠ "${raw}" is not a valid boolean — skipping`);
      return null;
    }

    case "date": {
      const iso = normalizeDate(raw);
      if (!iso) { console.warn(`      ⚠ "${raw}" could not be parsed as a date — skipping`); return null; }
      return { type: "date", value: iso };
    }

    case "datetime": {
      const iso = normalizeDate(raw);
      if (!iso) { console.warn(`      ⚠ "${raw}" could not be parsed as a datetime — skipping`); return null; }
      // SDK requires full RFC 3339 format for datetime
      const full = iso.length === 10 ? `${iso}T00:00:00Z` : iso;
      return { type: "datetime", value: full };
    }

    case "point": {
      // Expect "lon,lat" or "lat,lon" format
      const parts = raw.split(",").map(s => parseFloat(s.trim()));
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return { type: "point", lon: parts[0], lat: parts[1] };
      }
      console.warn(`      ⚠ "${raw}" is not a valid point (expected "lon,lat") — skipping`);
      return null;
    }

    default:
      // Fallback: treat as text
      return { type: "text", value: raw };
  }
}

main().catch(err => {
  closeInput();
  console.error("✗ Error:", err.message ?? err);
  process.exit(1);
});
