/**
 * DocuScan — Automatic Setup Script
 * Run: node scripts/setup.js
 *
 * This script:
 *  1. Checks Node.js version
 *  2. Installs circom globally if missing
 *  3. Creates build/ directory
 *  4. Compiles Circom circuit → R1CS + WASM
 *  5. Runs Powers of Tau trusted setup
 *  6. Generates proving key + verification key
 *  7. Writes proofs/verification_key.json
 *  Everything is cached — re-running is instant.
 */

"use strict";
const { execSync, spawnSync } = require("child_process");
const fs                      = require("fs");
const path                    = require("path");
const snarkjs                 = require("snarkjs");
const { getCurveFromName }    = require("ffjavascript");

// ── PATHS (all relative to project root) ─────────────────────────────────────
const ROOT    = path.resolve(__dirname, "..");
const BUILD   = path.join(ROOT, "build");
const PROOFS  = path.join(ROOT, "proofs");
const CIRCUIT = path.join(ROOT, "circuits", "document_hash.circom");

const R1CS    = path.join(BUILD, "document_hash.r1cs");
const WASM    = path.join(BUILD, "document_hash.wasm");
const SYM     = path.join(BUILD, "document_hash.sym");
const PTAU0   = path.join(BUILD, "pot12_0000.ptau");
const PTAU1   = path.join(BUILD, "pot12_0001.ptau");
const PTAU    = path.join(BUILD, "pot12_final.ptau");
const ZKEY0   = path.join(BUILD, "doc_hash_0000.zkey");
const ZKEY    = path.join(BUILD, "doc_hash_final.zkey");
const VKEY    = path.join(PROOFS, "verification_key.json");

// ── COLOURS ──────────────────────────────────────────────────────────────────
const C = {
  rst:"\x1b[0m", b:"\x1b[1m", dim:"\x1b[2m",
  grn:"\x1b[32m", red:"\x1b[31m", yel:"\x1b[33m",
  cyn:"\x1b[36m", mag:"\x1b[35m", blu:"\x1b[34m",
};
const ok   = m => console.log(`  ${C.grn}✔${C.rst}  ${m}`);
const fail = m => { console.error(`  ${C.red}✘${C.rst}  ${C.b}${m}${C.rst}`); process.exit(1); };
const info = m => console.log(`  ${C.blu}ℹ${C.rst}  ${m}`);
const skip = m => console.log(`  ${C.dim}↷  ${m} (cached — skipping)${C.rst}`);
const step = (n,t) => console.log(`\n${C.b}${C.cyn}── STEP ${n}: ${t} ──${C.rst}`);

function sh(cmd, label) {
  const t0 = Date.now();
  try {
    execSync(cmd, { stdio:"pipe", cwd:ROOT, timeout:180_000 });
    ok(`${label}  ${C.dim}(${Date.now()-t0}ms)${C.rst}`);
  } catch(e) {
    const msg = e.stderr?.toString().trim() || e.message;
    fail(`${label} failed:\n    ${msg.slice(0,300)}`);
  }
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function setup() {
  console.log(`\n${C.b}${C.cyn}╔══════════════════════════════════════════════════╗
║  DocuScan ZKP — Automatic Setup v2.0            ║
╚══════════════════════════════════════════════════╝${C.rst}\n`);

  // ── 1. NODE VERSION CHECK ─────────────────────────────────────────────────
  step(1, "Checking Node.js version");
  const ver = parseInt(process.version.slice(1).split(".")[0]);
  if (ver < 18) fail(`Node.js 18+ required. You have ${process.version}. Install from https://nodejs.org`);
  ok(`Node.js ${process.version} ✔`);

  // ── 2. CIRCOM CHECK / INSTALL ─────────────────────────────────────────────
  step(2, "Checking Circom compiler");
  const circomCheck = spawnSync("circom", ["--version"], { encoding:"utf8" });
  if (circomCheck.status !== 0 || circomCheck.error) {
    info("Circom not found — installing via npm...");
    sh("npm install -g circom", "Install circom globally");
  } else {
    ok(`Circom ${circomCheck.stdout.trim()} ✔`);
  }

  // ── 3. SNARKJS CLI CHECK ──────────────────────────────────────────────────
  step(3, "Checking SnarkJS CLI");
  const snarkCheck = spawnSync("snarkjs", ["--version"], { encoding:"utf8" });
  if (snarkCheck.status !== 0 || snarkCheck.error) {
    info("SnarkJS CLI not found — installing...");
    sh("npm install -g snarkjs", "Install snarkjs globally");
  } else {
    ok(`SnarkJS CLI ✔`);
  }

  // ── 4. CREATE DIRECTORIES ─────────────────────────────────────────────────
  step(4, "Creating build directories");
  [BUILD, PROOFS].forEach(d => {
    if (!fs.existsSync(d)) { fs.mkdirSync(d, { recursive:true }); ok(`Created ${path.relative(ROOT,d)}/`); }
    else { skip(path.relative(ROOT,d)+"/"); }
  });

  // ── 5. COMPILE CIRCUIT ────────────────────────────────────────────────────
  step(5, "Compiling Circom circuit → R1CS + WASM");
  if (!fs.existsSync(R1CS) || !fs.existsSync(WASM)) {
    // Run from circuits/ folder using relative output path — avoids Windows long-path issues
    execSync(`circom document_hash.circom --r1cs --wasm --sym -o "${BUILD}"`,
      { stdio:"pipe", cwd:path.join(ROOT,"circuits"), timeout:120_000 });
    ok(`circom compile  ${C.dim}(r1cs + wasm + sym)${C.rst}`);
    ok(`R1CS + WASM generated in build/`);
  } else {
    skip("document_hash.r1cs + document_hash.wasm");
  }

  // ── 6. POWERS OF TAU ─────────────────────────────────────────────────────
  step(6, "Powers of Tau trusted setup (2^12, BN128)");
  if (!fs.existsSync(PTAU)) {
    info("Running ceremony — this takes ~30s the first time...");
    const curve = await getCurveFromName("bn128");
    process.stdout.write("     Accumulator... ");
    await snarkjs.powersOfTau.newAccumulator(curve, 12, PTAU0);
    console.log(`${C.grn}✔${C.rst}`);
    process.stdout.write("     Contributing entropy... ");
    await snarkjs.powersOfTau.contribute(PTAU0, PTAU1, "DocuScan-Setup", "CanaraBankEntropy2024ZKP");
    console.log(`${C.grn}✔${C.rst}`);
    process.stdout.write("     Preparing phase2... ");
    await snarkjs.powersOfTau.preparePhase2(PTAU1, PTAU);
    console.log(`${C.grn}✔${C.rst}`);
    curve.terminate();
    ok(`pot12_final.ptau ready (${(fs.statSync(PTAU).size/1048576).toFixed(1)} MB)`);
  } else {
    skip(`pot12_final.ptau (${(fs.statSync(PTAU).size/1048576).toFixed(1)} MB)`);
  }

  // ── 7. PROVING KEY ────────────────────────────────────────────────────────
  // Run from inside build/ using short filenames — avoids Windows long-path issues
  step(7, "Generating Groth16 proving key");
  if (!fs.existsSync(ZKEY)) {
    const shBuild = (cmd, label) => {
      const t0 = Date.now();
      try {
        execSync(cmd, { stdio:"pipe", cwd:BUILD, timeout:180_000 });
        ok(`${label}  ${C.dim}(${Date.now()-t0}ms)${C.rst}`);
      } catch(e) {
        const msg = e.stderr?.toString().trim() || e.message;
        fail(`${label} failed:\n    ${msg.slice(0,300)}`);
      }
    };
    shBuild(`snarkjs zkey new document_hash.r1cs pot12_final.ptau doc_hash_0000.zkey`, "Phase 2 init");
    shBuild(`snarkjs zkey contribute doc_hash_0000.zkey doc_hash_final.zkey --name=DocuScan-v2 -e="DocuScan2024RBI"`, "Phase 2 contribute");
    ok("doc_hash_final.zkey generated");
  } else {
    skip("doc_hash_final.zkey");
  }

  // ── 8. VERIFICATION KEY ───────────────────────────────────────────────────
  step(8, "Exporting public verification key");
  if (!fs.existsSync(VKEY)) {
    // Export to build/ first then copy to proofs/ — avoids long path issues on Windows
    const tmpVkey = path.join(BUILD, "verification_key.json");
    execSync(`snarkjs zkey export verificationkey doc_hash_final.zkey verification_key.json`,
      { stdio:"pipe", cwd:BUILD, timeout:60_000 });
    fs.copyFileSync(tmpVkey, VKEY);
    const vk = JSON.parse(fs.readFileSync(VKEY,"utf8"));
    ok(`verification_key.json — protocol:${vk.protocol} nPublic:${vk.nPublic}`);
  } else {
    skip("verification_key.json");
  }

  // ── DONE ──────────────────────────────────────────────────────────────────
  console.log(`\n${C.b}${C.grn}══════════════════════════════════════════════════
  Setup complete! Run the demo:
  ${C.cyn}  node scripts/zkp_demo.js
${C.grn}══════════════════════════════════════════════════${C.rst}\n`);
}

setup().catch(e => {
  console.error(`\n${C.red}${C.b}Setup failed: ${e.message}${C.rst}`);
  console.error(C.dim + e.stack + C.rst);
  process.exit(1);
});
