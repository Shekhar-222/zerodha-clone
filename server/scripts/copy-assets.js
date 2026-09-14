// tsc only compiles .ts files — non-TS assets like schema.sql have to be copied into dist/
// by hand, or the built server crashes on startup looking for a file that was never copied.
const fs = require("fs");
const path = require("path");

const copies = [["src/db/schema.sql", "dist/db/schema.sql"]];

for (const [from, to] of copies) {
  const src = path.resolve(__dirname, "..", from);
  const dest = path.resolve(__dirname, "..", to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`copied ${from} -> ${to}`);
}
