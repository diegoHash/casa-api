import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { resolve } from "node:path";

const source = resolve(process.argv[2] ?? "C:/Users/Diego ASR/Documents/dump.sql");
const destination = resolve(
  process.argv[3] ?? "C:/Users/Diego ASR/Documents/dump.optimized.sql",
);

let carry = "";
let replacements = 0;
let relaxedNotNulls = 0;
let headerWritten = false;
const nullableViolations = new Set([
  "MONTO_GastoAlt",
  "MONTO_ReintegroAlt",
  "MONTO_UtilizAlt",
]);

function relaxKnownNullabilityViolations(text) {
  let output = text;
  for (const column of nullableViolations) {
    const pattern = `\`${column}\` DOUBLE NOT NULL`;
    const occurrences = output.split(pattern).length - 1;
    if (occurrences > 0) {
      output = output.replaceAll(pattern, `\`${column}\` DOUBLE NULL`);
      relaxedNotNulls += occurrences;
    }
  }
  return output;
}

const optimizer = new Transform({
  transform(chunk, _encoding, callback) {
    const text = carry + chunk.toString("utf8");
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline < 0) {
      carry = text;
      callback();
      return;
    }
    const complete = text.slice(0, lastNewline + 1);
    carry = text.slice(lastNewline + 1);
    const autocommitReplaced = complete.replaceAll(
      "SET autocommit=1;",
      "SET autocommit=0;",
    );
    replacements += (complete.match(/SET autocommit=1;/g) ?? []).length;
    const replaced = relaxKnownNullabilityViolations(autocommitReplaced);
    const prefix = headerWritten
      ? ""
      : "SET SESSION sql_mode='';\nSET SESSION unique_checks=0;\nSET SESSION foreign_key_checks=0;\n";
    headerWritten = true;
    callback(null, `${prefix}${replaced}`);
  },
  flush(callback) {
    const autocommitReplaced = carry.replaceAll(
      "SET autocommit=1;",
      "SET autocommit=0;",
    );
    replacements += (carry.match(/SET autocommit=1;/g) ?? []).length;
    const replaced = relaxKnownNullabilityViolations(autocommitReplaced);
    callback(null, `${replaced}\nCOMMIT;\n`);
  },
});

await pipeline(
  createReadStream(source),
  optimizer,
  createWriteStream(destination, { encoding: "utf8" }),
);

console.log(
  JSON.stringify(
    { source, destination, replacements, relaxedNotNulls },
    null,
    2,
  ),
);
