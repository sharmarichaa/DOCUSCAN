/**
 * DocuScan — Engine Orchestrator
 * ─────────────────────────────────────────────────────────────────
 * Thin wrapper around the ZKP module's analyzeDocument() function.
 *
 * The ZKP engine is the central orchestrator that internally
 * coordinates with the C++ Forensics Engine and the Python ML Model.
 *
 * Architecture:
 *   Backend (HTTP) → ZKP Engine → { Forensics Engine, ML Model }
 */

"use strict";

const path = require("path");
const fs   = require("fs");

// ── ZKP MODULE — the central analysis engine ──────────────────────
const ZKP_API_PATH = path.resolve(__dirname, "..", "docuscan-zkp", "scripts", "zkp_api");

let zkpApi = null;
try {
  zkpApi = require(ZKP_API_PATH);
  console.log("✅ ZKP engine loaded (orchestrates Forensics + ML internally)");
} catch (err) {
  console.error("❌ ZKP engine failed to load:", err.message);
  console.error("   Run: cd docuscan-zkp && npm install");
}

// ── PREVIEW IMAGE GENERATION ──────────────────────────────────────
let sharp = null;
try {
  sharp = require("sharp");
} catch {
  console.warn("⚠️  sharp not available — preview images will be generated client-side");
}

/**
 * Generate a base64 preview image from a file buffer.
 * @param {Buffer} buffer    - Raw file bytes
 * @param {string} filename  - Original filename
 * @returns {Promise<string[]>} - Array of "data:image/png;base64,..." strings
 */
async function generatePreviews(buffer, filename) {
  if (!sharp) return [];

  const ext = path.extname(filename).toLowerCase();
  const imageExts = [".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"];

  if (!imageExts.includes(ext) && ext !== ".pdf") return [];

  try {
    const preview = await sharp(buffer, ext === ".pdf" ? { density: 200 } : {})
      .resize(800, null, { withoutEnlargement: true })
      .png()
      .toBuffer();

    return [`data:image/png;base64,${preview.toString("base64")}`];
  } catch (err) {
    console.warn("⚠️  Preview generation failed:", err.message);
    return [];
  }
}

/**
 * Analyze a document by delegating to the ZKP engine.
 * The ZKP engine internally runs Forensics + ML engines in parallel.
 *
 * @param {Buffer} fileBuffer       - Raw uploaded file bytes
 * @param {string} originalName     - Original filename
 * @param {string} [registrationId] - Optional ZKP registration ID for verification
 * @returns {Promise<object>}       - AnalysisResponse matching frontend interface
 */
async function analyzeDocument(fileBuffer, originalName, registrationId = null) {
  if (!zkpApi) {
    throw new Error("ZKP engine not available. Run: cd docuscan-zkp && npm install");
  }

  // Delegate everything to the ZKP engine
  const result = await zkpApi.analyzeDocument(fileBuffer, originalName, registrationId);

  // Add preview images (the ZKP engine doesn't handle this — it's a backend concern)
  if (!result.previewImages || result.previewImages.length === 0) {
    result.previewImages = await generatePreviews(fileBuffer, originalName);
  }

  return result;
}

module.exports = { analyzeDocument, zkpApi };
