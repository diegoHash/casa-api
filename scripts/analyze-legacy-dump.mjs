import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

const inputPath = resolve(process.argv[2] ?? "C:/Users/Diego ASR/Documents/dump.sql");
const outputPath = resolve(
  process.argv[3] ??
    "C:/Users/Diego ASR/Documents/CaribbeanOne/casa-home/docs/legacy-audit/inventory.json",
);

const tables = new Map();
let currentTable = null;
let currentDefinition = [];
let lineNumber = 0;
let insertCount = 0;
let malformedInsertCount = 0;
let viewCount = 0;
let triggerCount = 0;
let procedureCount = 0;
let functionCount = 0;
let mojibakeLines = 0;

function tableRecord(name) {
  if (!tables.has(name)) {
    tables.set(name, {
      name,
      createLine: null,
      columns: [],
      primaryKey: [],
      uniqueIndexes: [],
      indexes: [],
      foreignKeys: [],
      rowCount: 0,
      insertColumns: [],
      sampleRows: [],
      columnProfiles: {},
      firstInsertLine: null,
      lastInsertLine: null,
    });
  }
  return tables.get(name);
}

function splitTopLevelComma(value) {
  const parts = [];
  let current = "";
  let quote = null;
  let depth = 0;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      current += char;
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseIdentifierList(value) {
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function parseColumn(definition) {
  const match = definition.match(/^`([^`]+)`\s+(.+?)(?:,\s*)?$/);
  if (!match) return null;
  const [, name, remainder] = match;
  const boundary = remainder.search(
    /\s+(?:NOT NULL|NULL|DEFAULT|AUTO_INCREMENT|COMMENT|COLLATE|CHARACTER SET)\b/i,
  );
  const type = (boundary === -1 ? remainder : remainder.slice(0, boundary)).trim();
  const nullable = !/\bNOT NULL\b/i.test(remainder);
  const defaultMatch = remainder.match(
    /\bDEFAULT\s+((?:'(?:\\.|[^'])*')|(?:"(?:\\.|[^"])*")|[^\s,]+)/i,
  );
  return {
    name,
    type,
    nullable,
    default: defaultMatch ? defaultMatch[1] : null,
    autoIncrement: /\bAUTO_INCREMENT\b/i.test(remainder),
    rawDefinition: definition.replace(/,\s*$/, ""),
  };
}

function parseCreateDefinition(table, lines) {
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("`")) {
      const column = parseColumn(line);
      if (column) table.columns.push(column);
      continue;
    }
    if (/^PRIMARY KEY/i.test(line)) {
      table.primaryKey = parseIdentifierList(line);
      continue;
    }
    const uniqueMatch = line.match(/^UNIQUE(?: KEY| INDEX)?(?:\s+`([^`]+)`)?/i);
    if (uniqueMatch) {
      table.uniqueIndexes.push({
        name: uniqueMatch[1] ?? null,
        columns: parseIdentifierList(line).slice(uniqueMatch[1] ? 1 : 0),
        rawDefinition: line.replace(/,\s*$/, ""),
      });
      continue;
    }
    const indexMatch = line.match(/^(?:KEY|INDEX)(?:\s+`([^`]+)`)?/i);
    if (indexMatch) {
      table.indexes.push({
        name: indexMatch[1] ?? null,
        columns: parseIdentifierList(line).slice(indexMatch[1] ? 1 : 0),
        rawDefinition: line.replace(/,\s*$/, ""),
      });
      continue;
    }
    if (/^(?:CONSTRAINT\b.*)?FOREIGN KEY/i.test(line)) {
      const referenced = line.match(
        /FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+`([^`]+)`\s*\(([^)]+)\)/i,
      );
      table.foreignKeys.push({
        columns: referenced ? parseIdentifierList(referenced[1]) : [],
        referencedTable: referenced?.[2] ?? null,
        referencedColumns: referenced ? parseIdentifierList(referenced[3]) : [],
        rawDefinition: line.replace(/,\s*$/, ""),
      });
    }
  }
}

function decodeSqlLiteral(value) {
  const trimmed = value.trim();
  if (/^NULL$/i.test(trimmed)) return null;
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed
      .slice(1, -1)
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\")
      .replace(/\\r/g, "\r")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  }
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : trimmed;
  }
  return trimmed;
}

function redactRow(row) {
  const sensitiveName =
    /(?:CLAVE|PASSWORD|CEDULA|DOCUMENT|E_MAIL|EMAIL|TELEFONO|DIRECCION|CONTACTO|REPRESENTANTE|NOMBRE|USUARIO|CUENTA|CUEB|NROCTA|CTABAN|RIF|NIT|CAMPO2)/i;
  return Object.fromEntries(
    Object.entries(row).map(([column, value]) => [
      column,
      value !== null && sensitiveName.test(column) ? "[REDACTED]" : value,
    ]),
  );
}

function profileRow(table, row) {
  for (const [column, value] of Object.entries(row)) {
    const profile = (table.columnProfiles[column] ??= {
      nullCount: 0,
      nonNullCount: 0,
      maxStringLength: 0,
      numericMin: null,
      numericMax: null,
      dateMin: null,
      dateMax: null,
    });
    if (value === null) {
      profile.nullCount += 1;
      continue;
    }
    profile.nonNullCount += 1;
    if (typeof value === "number") {
      profile.numericMin =
        profile.numericMin === null ? value : Math.min(profile.numericMin, value);
      profile.numericMax =
        profile.numericMax === null ? value : Math.max(profile.numericMax, value);
      continue;
    }
    const text = String(value);
    profile.maxStringLength = Math.max(profile.maxStringLength, text.length);
    if (/^\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?$/.test(text)) {
      profile.dateMin =
        profile.dateMin === null || text < profile.dateMin ? text : profile.dateMin;
      profile.dateMax =
        profile.dateMax === null || text > profile.dateMax ? text : profile.dateMax;
    }
  }
}

function parseInsert(line) {
  const match = line.match(
    /^INSERT INTO `([^`]+)`\s*\((.*?)\)\s*VALUES\s*\((.*)\);\s*$/,
  );
  if (!match) return null;
  const columns = parseIdentifierList(match[2]);
  const values = splitTopLevelComma(match[3]).map(decodeSqlLiteral);
  if (columns.length !== values.length) return null;
  return {
    tableName: match[1],
    columns,
    row: Object.fromEntries(columns.map((column, index) => [column, values[index]])),
  };
}

const input = createInterface({
  input: createReadStream(inputPath, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

for await (const line of input) {
  lineNumber += 1;
  if (/[ÃÂâ€]/.test(line)) mojibakeLines += 1;
  if (/^CREATE\s+(?:OR REPLACE\s+)?VIEW\b/i.test(line)) viewCount += 1;
  if (/^CREATE\s+TRIGGER\b/i.test(line)) triggerCount += 1;
  if (/^CREATE\s+PROCEDURE\b/i.test(line)) procedureCount += 1;
  if (/^CREATE\s+FUNCTION\b/i.test(line)) functionCount += 1;

  const createMatch = line.match(/^CREATE TABLE `([^`]+)`\s*\($/);
  if (createMatch) {
    currentTable = tableRecord(createMatch[1]);
    currentTable.createLine = lineNumber;
    currentDefinition = [];
    continue;
  }

  if (currentTable) {
    if (/^\)\s+ENGINE=/i.test(line)) {
      parseCreateDefinition(currentTable, currentDefinition);
      currentTable = null;
      currentDefinition = [];
    } else {
      currentDefinition.push(line);
    }
    continue;
  }

  if (line.startsWith("INSERT INTO `")) {
    insertCount += 1;
    const parsed = parseInsert(line);
    if (!parsed) {
      malformedInsertCount += 1;
      continue;
    }
    const table = tableRecord(parsed.tableName);
    table.rowCount += 1;
    table.firstInsertLine ??= lineNumber;
    table.lastInsertLine = lineNumber;
    if (table.insertColumns.length === 0) table.insertColumns = parsed.columns;
    profileRow(table, parsed.row);
    if (table.sampleRows.length < 3) {
      table.sampleRows.push(redactRow(parsed.row));
    }
  }
}

const records = [...tables.values()].sort((a, b) => a.createLine - b.createLine);
const summary = {
  source: inputPath,
  generatedAt: new Date().toISOString(),
  totalLines: lineNumber,
  totalTables: records.length,
  totalColumns: records.reduce((sum, table) => sum + table.columns.length, 0),
  totalRows: records.reduce((sum, table) => sum + table.rowCount, 0),
  totalInsertStatements: insertCount,
  malformedInsertStatements: malformedInsertCount,
  declaredForeignKeys: records.reduce((sum, table) => sum + table.foreignKeys.length, 0),
  views: viewCount,
  triggers: triggerCount,
  procedures: procedureCount,
  functions: functionCount,
  mojibakeLines,
  emptyTables: records.filter((table) => table.rowCount === 0).length,
  tablesWithoutPrimaryKey: records.filter((table) => table.primaryKey.length === 0).length,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({ summary, tables: records }, null, 2)}\n`);

const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = [
  [
    "table",
    "rows",
    "columns",
    "primary_key",
    "indexes",
    "foreign_keys",
    "create_line",
  ].join(","),
  ...records.map((table) =>
    [
      csvEscape(table.name),
      table.rowCount,
      table.columns.length,
      csvEscape(table.primaryKey.join("|")),
      table.indexes.length + table.uniqueIndexes.length,
      table.foreignKeys.length,
      table.createLine,
    ].join(","),
  ),
].join("\n");
writeFileSync(outputPath.replace(/\.json$/i, ".csv"), `${csv}\n`);

console.log(JSON.stringify(summary, null, 2));
