/**
 * DocuScan — Clean build artifacts
 * Run: node scripts/clean.js
 * Removes build/ and temp proof files. Keeps circuits/ and scripts/.
 */
"use strict";
const fs   = require("fs");
const path = require("path");
const ROOT  = path.resolve(__dirname, "..");

const targets = [
  path.join(ROOT, "build"),
  ...["registration_record.json","registration_proof.json","audit_log.json"]
    .map(f => path.join(ROOT,"proofs",f)),
];

targets.forEach(t => {
  if (fs.existsSync(t)) {
    fs.rmSync(t, { recursive:true, force:true });
    console.log(`  \x1b[33m✘\x1b[0m  Removed: ${path.relative(ROOT,t)}`);
  } else {
    console.log(`  \x1b[2m↷  ${path.relative(ROOT,t)} — not found\x1b[0m`);
  }
});

console.log("\n  \x1b[32m✔\x1b[0m  Clean complete. Run \x1b[33mnode scripts/setup.js\x1b[0m to rebuild.\n");
