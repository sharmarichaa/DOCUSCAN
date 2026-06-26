/**
 * DocuScan — Image & PDF Conversion Utilities
 * ─────────────────────────────────────────────────────────────────
 * Handles:
 *   - PDF → PNG page-by-page conversion (via pdf-poppler or fallback)
 *   - Image resizing for ML model input (256×256)
 *   - Base64 encoding for frontend preview images
 *   - Temp file management
 */

"use strict";

const fs    = require("fs");
const path  = require("path");
const sharp = require("sharp");

// ── TEMP DIRECTORY ────────────────────────────────────────────────
const TEMP_DIR = path.join(__dirname, "..", "temp");

function ensureTempDir() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Save an uploaded file buffer to the temp directory.
 * @param {Buffer} buffer   - Raw file bytes
 * @param {string} filename - Original filename
 * @returns {string}        - Absolute path to saved temp file
 */
function saveTempFile(buffer, filename) {
  ensureTempDir();
  const safeName = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const filePath = path.join(TEMP_DIR, safeName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Convert an image file to a 256×256 PNG for the ML model.
 * @param {string} inputPath  - Path to original image
 * @returns {Promise<string>} - Path to resized image
 */
async function resizeForML(inputPath) {
  ensureTempDir();
  const ext      = path.extname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const outPath  = path.join(TEMP_DIR, `${baseName}_ml_256.png`);

  await sharp(inputPath)
    .resize(256, 256, { fit: "fill" })
    .png()
    .toFile(outPath);

  return outPath;
}

/**
 * Convert a file (image or first page of PDF) to a base64 preview string
 * suitable for the frontend's `previewImages` array.
 * @param {string} filePath - Path to image file
 * @returns {Promise<string>} - "data:image/png;base64,..." string
 */
async function fileToBase64Preview(filePath) {
  const buffer = await sharp(filePath)
    .resize(800, null, { withoutEnlargement: true })
    .png()
    .toBuffer();

  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/**
 * Extract pages from a PDF as PNG images using sharp (first page only for now).
 * For multi-page PDF support, a library like pdf-poppler or pdf2pic would be needed.
 * Sharp supports single-page PDF → PNG natively.
 * @param {string} pdfPath    - Path to PDF file
 * @returns {Promise<string[]>} - Array of paths to extracted page images
 */
async function pdfToImages(pdfPath) {
  ensureTempDir();
  const baseName = path.basename(pdfPath, ".pdf");
  const pages    = [];

  try {
    // Sharp can render the first page of a PDF
    const outPath = path.join(TEMP_DIR, `${baseName}_page_0.png`);
    await sharp(pdfPath, { density: 200 })
      .png()
      .toFile(outPath);
    pages.push(outPath);
  } catch (err) {
    console.warn("⚠️  PDF conversion failed (sharp):", err.message);
    console.warn("   Continuing with document analysis without preview images.");
  }

  return pages;
}

/**
 * Determine if a file is a PDF based on extension.
 * @param {string} filename
 * @returns {boolean}
 */
function isPDF(filename) {
  return path.extname(filename).toLowerCase() === ".pdf";
}

/**
 * Determine if a file is an image based on extension.
 * @param {string} filename
 * @returns {boolean}
 */
function isImage(filename) {
  const ext = path.extname(filename).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"].includes(ext);
}

/**
 * Clean up temp files older than the given age (in milliseconds).
 * @param {number} maxAgeMs - Max age in ms (default: 10 minutes)
 */
function cleanupTemp(maxAgeMs = 10 * 60 * 1000) {
  if (!fs.existsSync(TEMP_DIR)) return;

  const now   = Date.now();
  const files = fs.readdirSync(TEMP_DIR);

  for (const file of files) {
    const fullPath = path.join(TEMP_DIR, file);
    try {
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(fullPath);
      }
    } catch {
      // ignore
    }
  }
}

module.exports = {
  TEMP_DIR,
  ensureTempDir,
  saveTempFile,
  resizeForML,
  fileToBase64Preview,
  pdfToImages,
  isPDF,
  isImage,
  cleanupTemp,
};
