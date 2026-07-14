/**
 * Lists .env.local key names and value lengths only (no secret values).
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const path = resolve(process.cwd(), ".env.local");
if (!existsSync(path)) {
  console.log("missing .env.local");
  process.exit(1);
}

const buf = readFileSync(path);
const text = buf.toString("utf8").replace(/^\uFEFF/, "");
const lines = text.split(/\r?\n/);
console.log(`bytes=${buf.length} lines=${lines.length}`);

for (let n = 0; n < lines.length; n++) {
  const raw = lines[n] ?? "";
  const line = raw.trim();
  if (!line || line.startsWith("#")) {
    if (line.startsWith("#")) console.log(`L${n + 1}: comment`);
    continue;
  }
  const i = line.indexOf("=");
  if (i < 0) {
    console.log(`L${n + 1}: INVALID_NO_EQUALS`);
    continue;
  }
  const key = line.slice(0, i).trim();
  let val = line.slice(i + 1).trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  const badKey = /[^A-Z0-9_]/.test(key);
  console.log(
    `L${n + 1}: key=${JSON.stringify(key)} len=${val.length} empty=${val.length === 0} badKeyChars=${badKey}`,
  );
}
