/**
 * DocuScan — Verify Only
 * Run: node scripts/verify_only.js
 * Verifies an existing registration proof without re-running the full demo.
 */
"use strict";
const fs      = require("fs");
const path    = require("path");
const snarkjs = require("snarkjs");

const ROOT   = path.resolve(__dirname, "..");
const PROOFS = path.join(ROOT, "proofs");
const VKEY   = path.join(PROOFS, "verification_key.json");
const PROOF  = path.join(PROOFS, "registration_proof.json");

const C = {
  rst:"\x1b[0m", b:"\x1b[1m", grn:"\x1b[32m",
  red:"\x1b[31m", cyn:"\x1b[36m", dim:"\x1b[2m",
};

async function verify() {
  console.log(`\n${C.b}${C.cyn}DocuScan — Proof Verifier${C.rst}\n`);

  [VKEY, PROOF].forEach(f => {
    if (!fs.existsSync(f)) {
      console.error(`${C.red}Missing: ${f}${C.rst}\nRun setup + demo first.`);
      process.exit(1);
    }
  });

  const vKey      = JSON.parse(fs.readFileSync(VKEY,"utf8"));
  const proofFile = JSON.parse(fs.readFileSync(PROOF,"utf8"));
  const { proof, publicSignals } = proofFile;

  console.log(`  ${C.dim}Protocol : ${vKey.protocol}${C.rst}`);
  console.log(`  ${C.dim}Curve    : ${vKey.curve}${C.rst}`);
  console.log(`  ${C.dim}nPublic  : ${vKey.nPublic}${C.rst}`);
  console.log(`  ${C.dim}DocID    : ${proofFile.docID}${C.rst}`);
  console.log(`  ${C.dim}LoanRef  : ${proofFile.loanRef}${C.rst}`);
  console.log();

  const t0     = Date.now();
  const valid  = await snarkjs.groth16.verify(vKey, publicSignals, proof);
  const ms     = Date.now()-t0;

  if (valid) {
    console.log(`  ${C.grn}${C.b}✔  PROOF VALID  ·  Verified in ${ms}ms${C.rst}`);
    console.log(`  ${C.dim}Groth16 BN128 pairing check passed${C.rst}\n`);
  } else {
    console.log(`  ${C.red}${C.b}✘  PROOF INVALID${C.rst}\n`);
  }
}

verify().catch(e => { console.error(e.message); process.exit(1); });
