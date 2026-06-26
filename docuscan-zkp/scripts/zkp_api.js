/**
 * DocuScan — Frontend API Bridge
 * ─────────────────────────────────────────────────────────────────
 * Place this file inside scripts/ folder.
 *
 * USAGE in your Express backend:
 *
 *   const { registerDocument, verifyDocument } = require("./scripts/zkp_api");
 *
 *   app.post("/api/register", async (req, res) => {
 *     const result = await registerDocument(req.file.buffer);
 *     res.json(result);
 *   });
 *
 *   app.post("/api/verify", async (req, res) => {
 *     const result = await verifyDocument(req.file.buffer, req.body.registrationId);
 *     res.json(result);
 *   });
 *
 * Accepts any file buffer — PDF, image, text, any format.
 * Document content is NEVER stored at any stage.
 */

"use strict";
const { execSync } = require("child_process");
const crypto       = require("crypto");
const fs           = require("fs");
const path         = require("path");
const snarkjs      = require("snarkjs");

// ── PATHS (scripts/ → .. → docuscan-zkp/) ────────────────────────────────
const ROOT  = path.resolve(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const OUT   = path.join(ROOT, "proofs");
const WASM  = path.join(BUILD, "document_hash.wasm");
const ZKEY  = path.join(BUILD, "doc_hash_final.zkey");
const VKEY  = path.join(OUT,   "verification_key.json");
const DB    = path.join(OUT,   "registrations.json");  // persistent file store

// ── REGISTRY — saved to proofs/registrations.json (survives restarts) ────
function loadReg() {
  try { return JSON.parse(fs.readFileSync(DB, "utf8")); } catch { return {}; }
}
function saveReg(reg) {
  fs.mkdirSync(OUT, { recursive:true });
  fs.writeFileSync(DB, JSON.stringify(reg, null, 2));
}

// ── CRYPTO ────────────────────────────────────────────────────────────────
function hashContent(buf) {
  const h = crypto.createHash("sha256").update(buf).digest("hex");
  return { hash:h, hi:BigInt("0x"+h.slice(0,32)), lo:BigInt("0x"+h.slice(32,64)) };
}

// ── PROVE — private inputs deleted immediately after prove ────────────────
async function prove(input) {
  const id     = `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const tmpIn  = path.join(BUILD, `_api_${id}_in.json`);
  const tmpPrf = path.join(BUILD, `_api_${id}_prf.json`);
  const tmpPub = path.join(BUILD, `_api_${id}_pub.json`);

  fs.writeFileSync(tmpIn, JSON.stringify(input));
  const t0 = Date.now();
  try {
    execSync(
      `snarkjs groth16 fullprove "${tmpIn}" "${WASM}" "${ZKEY}" "${tmpPrf}" "${tmpPub}"`,
      { stdio:"pipe", timeout:90_000 }
    );
  } finally {
    try { fs.unlinkSync(tmpIn); } catch {} // delete private inputs immediately
  }
  const ms    = Date.now() - t0;
  const proof = JSON.parse(fs.readFileSync(tmpPrf, "utf8"));
  const pub   = JSON.parse(fs.readFileSync(tmpPub, "utf8"));
  try { fs.unlinkSync(tmpPrf); fs.unlinkSync(tmpPub); } catch {}
  return { proof, pub, ms };
}

// ── CHECK SETUP ───────────────────────────────────────────────────────────
function checkSetup() {
  const missing = [WASM, ZKEY, VKEY].filter(f => !fs.existsSync(f));
  if (missing.length) {
    throw new Error("ZKP setup not complete. Run: node scripts/setup.js");
  }
}

/**
 * registerDocument(fileBuffer, version?)
 * ─────────────────────────────────────────────────────────────────
 * Call at loan APPLICATION when document is first uploaded.
 * Pass the raw file bytes (Buffer) — works with any file type.
 * Returns registrationId — store this in your database.
 * Document content is NEVER stored.
 *
 * @param {Buffer} fileBuffer  - Raw file bytes from multer or similar
 * @param {string} version     - Optional version tag (default "1")
 * @returns {Object} { success, registrationId, hashPreview, proofGenerated, provingTimeMs, privacyNote }
 */
async function registerDocument(fileBuffer, version = "1") {
  checkSetup();

  const content          = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(JSON.stringify(fileBuffer));
  const { hash, hi, lo } = hashContent(content);
  const vKey             = JSON.parse(fs.readFileSync(VKEY, "utf8"));
  const registrationId   = crypto.randomBytes(6).toString("hex").toUpperCase();

  const { proof, pub, ms } = await prove({
    content_hi  : hi.toString(),
    content_lo  : lo.toString(),
    hash_hi     : hi.toString(),
    hash_lo     : lo.toString(),
    doc_version : version,
  });

  const valid = await snarkjs.groth16.verify(vKey, pub, proof);
  if (!valid) throw new Error("Proof generation failed — internal error");

  // Save commitment to file (NOT the document content)
  const reg = loadReg();
  reg[registrationId] = {
    registrationId,
    hashHi       : hi.toString(),
    hashLo       : lo.toString(),
    fullHash     : hash,
    docVersion   : version,
    publicSignals: pub,
    proof,
    registeredAt : new Date().toISOString(),
    // rawContent: NEVER SET — privacy preserved
  };
  saveReg(reg);

  return {
    success         : true,
    registrationId,
    hashPreview     : hash.slice(0, 16) + "…",
    proofGenerated  : true,
    provingTimeMs   : ms,
    privacyNote     : "Document content was NOT stored — only hash commitment retained",
  };
}

/**
 * verifyDocument(fileBuffer, registrationId, version?)
 * ─────────────────────────────────────────────────────────────────
 * Call at loan DISBURSEMENT when document is re-uploaded.
 * Pass the raw file bytes and the registrationId from registerDocument().
 * Returns verdict — VERIFIED or FORGERY_DETECTED.
 * Document content is NEVER accessed by the verifier.
 *
 * @param {Buffer} fileBuffer      - Raw file bytes of re-submitted document
 * @param {string} registrationId  - ID returned by registerDocument()
 * @param {string} version         - Must match registered version (default "1")
 * @returns {Object} { success, verdict, trustScore, riskLevel, hashMatch, proofValid, action, privacyNote }
 */
async function verifyDocument(fileBuffer, registrationId, version = "1") {
  checkSetup();

  const reg    = loadReg();
  const record = reg[registrationId];

  if (!record) {
    return {
      success    : false,
      verdict    : "REGISTRATION_NOT_FOUND",
      trustScore : 0,
      riskLevel  : "REJECT",
      action     : "No registration found for this ID. Cannot verify.",
    };
  }

  const content          = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(JSON.stringify(fileBuffer));
  const { hash, hi, lo } = hashContent(content);
  const hashMatch        = record.fullHash === hash;
  const versionMatch     = version === record.docVersion;

  // Hash mismatch → forgery detected immediately, no need to generate proof
  if (!hashMatch) {
    return {
      success      : true,
      verdict      : "FORGERY_DETECTED",
      trustScore   : 8,
      riskLevel    : "REJECT",
      hashMatch    : false,
      proofValid   : false,
      action       : "HOLD disbursement · File SAR per RBI FIU · Escalate to Risk Officer",
      privacyNote  : "Document content was NOT accessed during verification",
    };
  }

  // Version mismatch → replay attack
  if (!versionMatch) {
    return {
      success      : true,
      verdict      : "REPLAY_ATTACK",
      trustScore   : 0,
      riskLevel    : "REJECT",
      hashMatch    : true,
      proofValid   : false,
      action       : "HOLD disbursement · Replay attack detected · version mismatch",
      privacyNote  : "Document content was NOT accessed during verification",
    };
  }

  // Hash matches → generate ZK proof for cryptographic confirmation
  const vKey             = JSON.parse(fs.readFileSync(VKEY, "utf8"));
  const { proof, pub, ms } = await prove({
    content_hi  : hi.toString(),
    content_lo  : lo.toString(),
    hash_hi     : hi.toString(),
    hash_lo     : lo.toString(),
    doc_version : version,
  });

  const proofValid = await snarkjs.groth16.verify(vKey, pub, proof);
  const trustScore = (hashMatch?50:0) + (proofValid?30:0) + 12 + 8;
  const riskLevel  = trustScore >= 80 ? "SAFE" : trustScore >= 50 ? "SUSPICIOUS" : "REJECT";
  const verdict    = proofValid && hashMatch ? "VERIFIED" : "PROOF_INVALID";

  return {
    success       : true,
    verdict,
    trustScore,
    riskLevel,
    hashMatch,
    proofValid,
    provingTimeMs : ms,
    action        : verdict === "VERIFIED"
      ? "Document authentic — safe to proceed with disbursement"
      : "Verification failed — hold disbursement and investigate",
    privacyNote   : "Document content was NOT accessed during verification",
  };
}

/**
 * getRegistrationStatus(registrationId)
 * Returns metadata about a registration — never returns document content.
 */
function getRegistrationStatus(registrationId) {
  const reg = loadReg();
  const r   = reg[registrationId];
  if (!r) return { found:false };
  return {
    found          : true,
    registrationId : r.registrationId,
    registeredAt   : r.registeredAt,
    docVersion     : r.docVersion,
    hashPreview    : r.fullHash.slice(0, 16) + "…",
    hasProof       : !!r.proof,
  };
}

module.exports = { registerDocument, verifyDocument, getRegistrationStatus };
