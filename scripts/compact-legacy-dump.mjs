import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const source = resolve(process.argv[2] ?? "C:/Users/Diego ASR/Documents/dump.sql");
const destination = resolve(
  process.argv[3] ?? "C:/Users/Diego ASR/Documents/dump.audit.sql",
);
const chunkSize = Number(process.argv[4] ?? 500);
const nullableViolations = new Set([
  "MONTO_GastoAlt",
  "MONTO_ReintegroAlt",
  "MONTO_UtilizAlt",
]);

const input = createInterface({
  input: createReadStream(source, { encoding: "utf8" }),
  crlfDelay: Infinity,
});
const output = createWriteStream(destination, { encoding: "utf8" });
let bufferedPrefix = null;
let bufferedValues = [];
let sourceInserts = 0;
let compactedInserts = 0;
let relaxedNotNulls = 0;

async function write(text) {
  if (!output.write(text)) await once(output, "drain");
}

async function flushInsert() {
  if (!bufferedPrefix) return;
  await write(
    `${bufferedPrefix}${bufferedValues.map((value) => `(${value})`).join(",")};\n`,
  );
  compactedInserts += 1;
  bufferedPrefix = null;
  bufferedValues = [];
}

await write(
  "SET SESSION sql_mode='';\nSET SESSION unique_checks=0;\nSET SESSION foreign_key_checks=0;\n",
);

for await (let line of input) {
  if (line === "SET autocommit=1;") line = "SET autocommit=0;";
  for (const column of nullableViolations) {
    const pattern = `\`${column}\` DOUBLE NOT NULL`;
    if (line.includes(pattern)) {
      line = line.replace(pattern, `\`${column}\` DOUBLE NULL`);
      relaxedNotNulls += 1;
    }
  }

  const insert = line.match(
    /^(INSERT INTO `[^`]+` \(.*\) VALUES )\((.*)\);$/,
  );
  if (!insert) {
    await flushInsert();
    await write(`${line}\n`);
    continue;
  }

  sourceInserts += 1;
  const [, prefix, values] = insert;
  if (
    bufferedPrefix &&
    (bufferedPrefix !== prefix || bufferedValues.length >= chunkSize)
  ) {
    await flushInsert();
  }
  bufferedPrefix = prefix;
  bufferedValues.push(values);
}

await flushInsert();
await write("COMMIT;\n");
output.end();
await once(output, "finish");

console.log(
  JSON.stringify(
    {
      source,
      destination,
      chunkSize,
      sourceInserts,
      compactedInserts,
      relaxedNotNulls,
    },
    null,
    2,
  ),
);
