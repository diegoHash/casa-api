import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import MDBReader from "mdb-reader";

const inputPath = resolve(
  process.argv[2] ??
    "C:/Users/Diego ASR/Downloads/BDCondominioCaribbean.mdb",
);
const outputPath = resolve(
  process.argv[3] ??
    "C:/Users/Diego ASR/Documents/CaribbeanOne/casa-home/docs/legacy-audit/mdb-inventory.json",
);

const sensitiveName =
  /(?:CLAVE|PASSWORD|CEDULA|DOCUMENT|E_MAIL|EMAIL|TELEFONO|DIRECCION|CONTACTO|REPRESENTANTE|NOMBRE|USUARIO|CUENTA|CUEB|NROCTA|CTABAN|RIF|NIT|CAMPO2)/i;
const domainName =
  /(?:MONEDA|STATUS|ESTADO|CONDICION|DEB_CRE|DEBCRE|DEBCRED|TIPODEPT|DElREG|CONCILIADA|APLICA|APL_|TRANSF|CONTAB|GENCIERRE|SUMRES|ANULADO|COBTRA)$/i;

function dateValue(value) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(
    value.getUTCDate(),
  )} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(
    value.getUTCSeconds(),
  )}`;
}

function normalizedValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return dateValue(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) {
    return `[binary:${value.byteLength}:${createHash("sha256").update(value).digest("hex")}]`;
  }
  if (Array.isArray(value)) return value.map(normalizedValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizedValue(item)]),
    );
  }
  return value;
}

function redactedRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([column, value]) => [
      column,
      value !== null && value !== undefined && sensitiveName.test(column)
        ? "[REDACTED]"
        : normalizedValue(value),
    ]),
  );
}

function createProfile() {
  return {
    nullCount: 0,
    emptyStringCount: 0,
    nonNullCount: 0,
    maxStringLength: 0,
    numericMin: null,
    numericMax: null,
    dateMin: null,
    dateMax: null,
    mojibakeCount: 0,
    domainValues: {},
    domainOverflow: false,
  };
}

function updateProfile(profile, columnName, value) {
  if (value === null || value === undefined) {
    profile.nullCount += 1;
    return;
  }
  profile.nonNullCount += 1;
  if (value instanceof Date) {
    const date = dateValue(value);
    profile.dateMin =
      profile.dateMin === null || date < profile.dateMin ? date : profile.dateMin;
    profile.dateMax =
      profile.dateMax === null || date > profile.dateMax ? date : profile.dateMax;
    return;
  }
  if (typeof value === "number") {
    profile.numericMin =
      profile.numericMin === null ? value : Math.min(profile.numericMin, value);
    profile.numericMax =
      profile.numericMax === null ? value : Math.max(profile.numericMax, value);
  }
  if (typeof value === "string") {
    if (value.length === 0) profile.emptyStringCount += 1;
    profile.maxStringLength = Math.max(profile.maxStringLength, value.length);
    if (/[ÃÂâ€]/.test(value)) profile.mojibakeCount += 1;
  }
  if (domainName.test(columnName) && !profile.domainOverflow) {
    const key = String(normalizedValue(value));
    profile.domainValues[key] = (profile.domainValues[key] ?? 0) + 1;
    if (Object.keys(profile.domainValues).length > 30) {
      profile.domainValues = {};
      profile.domainOverflow = true;
    }
  }
}

const buffer = await readFile(inputPath);
const sourceHash = createHash("sha256").update(buffer).digest("hex");
const reader = new MDBReader(buffer);
const tableNames = reader.getTableNames({
  normalTables: true,
  systemTables: false,
  linkedTables: false,
});
const tables = [];
let totalRows = 0;
let totalColumns = 0;
let totalMojibakeValues = 0;

for (const sourceName of tableNames) {
  const table = reader.getTable(sourceName);
  const columns = table.getColumns().map((column) => ({
    name: column.name,
    type: column.type,
    size: column.size,
    fixedLength: column.fixedLength,
    nullable: column.nullable,
    autoLong: column.autoLong,
    autoUUID: column.autoUUID,
    precision: column.precision ?? null,
    scale: column.scale ?? null,
  }));
  const rows = table.getData();
  const profiles = Object.fromEntries(
    columns.map((column) => [column.name, createProfile()]),
  );
  const contentHash = createHash("sha256");

  for (const row of rows) {
    const normalizedRow = {};
    for (const column of columns) {
      const value = row[column.name];
      updateProfile(profiles[column.name], column.name, value);
      normalizedRow[column.name] = normalizedValue(value);
    }
    contentHash.update(JSON.stringify(normalizedRow));
    contentHash.update("\n");
  }

  totalRows += rows.length;
  totalColumns += columns.length;
  totalMojibakeValues += Object.values(profiles).reduce(
    (sum, profile) => sum + profile.mojibakeCount,
    0,
  );
  tables.push({
    name: sourceName,
    declaredRowCount: table.rowCount,
    rowsRead: rows.length,
    columnCount: columns.length,
    columns,
    columnProfiles: profiles,
    sampleRows: rows.slice(0, 3).map(redactedRow),
    orderedContentHashSha256: contentHash.digest("hex"),
  });
}

const password = reader.getPassword();
const summary = {
  source: inputPath,
  sourceSha256: sourceHash,
  generatedAt: new Date().toISOString(),
  databaseCreatedAt: reader.getCreationDate()?.toISOString() ?? null,
  passwordProtected: Boolean(password),
  totalTables: tables.length,
  totalColumns,
  totalRows,
  declaredRowsMatchReadRows: tables.every(
    (table) => table.declaredRowCount === table.rowsRead,
  ),
  totalMojibakeValues,
};

mkdirSync(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ summary, tables }, null, 2)}\n`);

const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = [
  ["table", "rows_declared", "rows_read", "columns", "content_sha256"].join(","),
  ...tables.map((table) =>
    [
      csvEscape(table.name),
      table.declaredRowCount,
      table.rowsRead,
      table.columnCount,
      csvEscape(table.orderedContentHashSha256),
    ].join(","),
  ),
].join("\n");
await writeFile(outputPath.replace(/\.json$/i, ".csv"), `${csv}\n`);

console.log(JSON.stringify(summary, null, 2));
