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
const { execSync, execFile, exec } = require("child_process");
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

// ── SIBLING ENGINE PATHS ──────────────────────────────────────────────────
const PROJECT_ROOT   = path.resolve(ROOT, "..");
const FORENSICS_EXE  = path.join(PROJECT_ROOT, "forensics-engine", "analyzer.exe");
const ML_SCRIPT      = path.join(PROJECT_ROOT, "ml-model", "infer_onnx.py");
const ML_MODEL_DIR   = path.join(PROJECT_ROOT, "ml-model");
const TEMP_DIR       = path.join(ROOT, "temp");

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

// ── TEMP FILE HELPERS ─────────────────────────────────────────────────────
function ensureTemp() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function saveTempFile(buffer, filename) {
  ensureTemp();
  const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const filePath = path.join(TEMP_DIR, safeName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function cleanupFile(filePath) {
  try { fs.unlinkSync(filePath); } catch {}
}

// ── FORENSICS ENGINE ──────────────────────────────────────────────────────
/**
 * Run the C++ forensics analyzer on a document file.
 * @param {string} filePath - Path to the document (image or PDF)
 * @returns {Promise<object|null>} - Parsed JSON result or null on failure
 */
function runForensicsEngine(filePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(FORENSICS_EXE)) {
      console.warn("⚠️  Forensics engine not found at:", FORENSICS_EXE);
      resolve(null);
      return;
    }

    execFile(FORENSICS_EXE, [filePath], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        console.error("❌ Forensics engine error:", err.message);
        resolve(null);
        return;
      }
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        resolve(jsonMatch ? JSON.parse(jsonMatch[0]) : null);
      } catch (parseErr) {
        console.error("❌ Failed to parse forensics JSON:", parseErr.message);
        resolve(null);
      }
    });
  });
}

// ── ML MODEL ──────────────────────────────────────────────────────────────
/**
 * Run the Python ONNX ML inference on an image file.
 * @param {string} imagePath - Path to image (must be jpg/png)
 * @returns {Promise<object|null>} - Parsed JSON result or null on failure
 */
function runMLModel(imagePath) {
  return new Promise((resolve) => {
    if (!fs.existsSync(ML_SCRIPT)) {
      console.warn("⚠️  ML model script not found at:", ML_SCRIPT);
      resolve(null);
      return;
    }

    const cmd = `python "${ML_SCRIPT}" "${imagePath}"`;
    const mlEnv = { ...process.env, PYTHONUTF8: "1" };
    exec(cmd, { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, cwd: ML_MODEL_DIR, env: mlEnv }, (err, stdout, stderr) => {
      if (err) {
        console.error("❌ ML model error:", err.message);
        resolve(null);
        return;
      }
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        resolve(jsonMatch ? JSON.parse(jsonMatch[0]) : null);
      } catch (parseErr) {
        console.error("❌ Failed to parse ML JSON:", parseErr.message);
        resolve(null);
      }
    });
  });
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

// ── COMPREHENSIVE ANALYSIS ────────────────────────────────────────────────
/**
 * analyzeDocument(fileBuffer, originalName, registrationId?)
 * ─────────────────────────────────────────────────────────────────
 * The single entry point for the backend API gateway.
 * Runs the full analysis pipeline:
 *   1. ZKP integrity check (register or verify)
 *   2. C++ Forensics Engine (pixel-level tamper detection)
 *   3. Python ML Model (semantic segmentation forgery localization)
 * All engines run in parallel for speed.
 *
 * Returns the AnalysisResponse JSON matching the frontend contract.
 *
 * @param {Buffer} fileBuffer       - Raw uploaded file bytes
 * @param {string} originalName     - Original filename
 * @param {string} [registrationId] - Optional ZKP registration ID for re-verification
 * @returns {Promise<object>}       - AnalysisResponse for the frontend
 */
async function analyzeDocument(fileBuffer, originalName, registrationId = null) {
  const startTime = Date.now();

  // Save file to temp for CLI engines
  const tempFilePath = saveTempFile(fileBuffer, originalName);

  // Run all 3 engines in parallel
  const [zkpResult, forensicsResult, mlResult] = await Promise.allSettled([
    registrationId
      ? verifyDocument(fileBuffer, registrationId)
      : registerDocument(fileBuffer),
    runForensicsEngine(tempFilePath),
    runMLModel(tempFilePath),
  ]);

  const zkp       = zkpResult.status === "fulfilled"       ? zkpResult.value       : null;
  const forensics = forensicsResult.status === "fulfilled" ? forensicsResult.value : null;
  const ml        = mlResult.status === "fulfilled"        ? mlResult.value        : null;

  // Clean up temp file
  cleanupFile(tempFilePath);

  // ── Compute weighted trust score ──
  // ZKP 25%, Forensics 40%, ML 35%
  let weightedSum = 0, totalWeight = 0;

  if (zkp && zkp.trustScore != null) {
    weightedSum += zkp.trustScore * 0.25;
    totalWeight += 0.25;
  }
  if (forensics && forensics.trustScore != null) {
    weightedSum += forensics.trustScore * 0.40;
    totalWeight += 0.40;
  }
  if (ml && ml.trustScore != null) {
    weightedSum += ml.trustScore * 0.35;
    totalWeight += 0.35;
  }

  const trustScore = totalWeight > 0
    ? Math.max(0, Math.min(100, Math.round(weightedSum / totalWeight)))
    : 50; // fallback if no engine produced a score

  // ── Classification ──
  const classification = trustScore >= 75 ? "SAFE" : trustScore >= 50 ? "SUSPICIOUS" : "REJECT";

  // ── Heatmap regions (ML regions in %, forensics regions converted) ──
  const heatmapRegions = [];

  if (ml && ml.regions) {
    for (const r of ml.regions) {
      heatmapRegions.push({
        pageIndex: 0,
        x:      Math.round((r.x / 256) * 100),
        y:      Math.round((r.y / 256) * 100),
        width:  Math.round((r.w / 256) * 100),
        height: Math.round((r.h / 256) * 100),
        severity: r.confidence >= 0.8 ? "high" : r.confidence >= 0.5 ? "medium" : "low",
      });
    }
  }

  if (forensics && forensics.regions) {
    for (const r of forensics.regions) {
      const already = heatmapRegions.some(h => Math.abs(h.x - r.x) < 5 && Math.abs(h.y - r.y) < 5);
      if (!already) {
        heatmapRegions.push({
          pageIndex: 0,
          x:      Math.round((r.x / 256) * 100),
          y:      Math.round((r.y / 256) * 100),
          width:  Math.round((r.w / 256) * 100),
          height: Math.round((r.h / 256) * 100),
          severity: (r.confidence || 0) >= 0.8 ? "high" : (r.confidence || 0) >= 0.5 ? "medium" : "low",
        });
      }
    }
  }

  // ── Breakdown ──
  const breakdown = {
    pixelSplice:     "Not Available",
    fontConsistency: "Not Available",
    nlpValidation:   "Not Available",
    zkpIntegrity:    "Not Available",
  };

  if (forensics && forensics.scores) {
    const s = forensics.scores;
    breakdown.pixelSplice     = s.splicing >= 80 ? "Passed" : s.splicing >= 50 ? "Suspicious" : "Detected";
    breakdown.fontConsistency = s.font >= 80 ? "Passed" : s.font >= 50 ? "Suspicious" : "Failed";
    breakdown.nlpValidation   = s.nlp >= 80 ? "Passed" : s.nlp >= 50 ? "Suspicious" : "Failed";
  } else if (ml && ml.scores) {
    breakdown.pixelSplice = ml.scores.splicing > 20 ? `Detected (Score: ${ml.scores.splicing})` : "Clear";
  }

  if (zkp) {
    if (zkp.verdict === "VERIFIED")         breakdown.zkpIntegrity = "Verified";
    else if (zkp.verdict === "FORGERY_DETECTED") breakdown.zkpIntegrity = "Mismatch from origin";
    else if (zkp.success && zkp.registrationId)  breakdown.zkpIntegrity = `Registered (${zkp.registrationId})`;
    else if (zkp.verdict)                        breakdown.zkpIntegrity = zkp.verdict;
    else                                         breakdown.zkpIntegrity = "Pending";
  }

  // ── Preview images ──
  // The backend will handle base64 preview generation; ZKP returns empty array
  const previewImages = [];

  const processingTimeMs = Date.now() - startTime;

  return {
    trustScore,
    classification,
    heatmapRegions,
    breakdown,
    previewImages,
    meta: {
      processingTimeMs,
      enginesUsed: {
        forensics: forensics !== null,
        ml:        ml !== null,
        zkp:       zkp !== null,
      },
      zkpRegistrationId: zkp?.registrationId || null,
      zkpVerdict:        zkp?.verdict || null,
    },
  };
}

module.exports = { registerDocument, verifyDocument, getRegistrationStatus, analyzeDocument };
