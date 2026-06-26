/**
 * DocuScan — Backend API Gateway Server
 * ─────────────────────────────────────────────────────────────────
 * Thin HTTP layer that delegates all analysis to the ZKP engine.
 * The ZKP engine internally orchestrates the Forensics + ML engines.
 *
 * Architecture:
 *   Frontend → Backend (this server) → ZKP Engine → { Forensics, ML }
 *
 * Install:   npm install
 * Run:       npm run dev     (with --watch auto-reload)
 *            npm start       (production)
 *
 * Endpoints:
 *   GET   /api/health              — Health check
 *   POST  /api/analyze             — Full document analysis (via ZKP engine)
 *   POST  /api/zkp/register        — Register document for ZKP (standalone)
 *   POST  /api/zkp/verify          — Verify document via ZKP (standalone)
 *   GET   /api/zkp/status/:id      — Check ZKP registration status
 */

"use strict";

const express = require("express");
const cors    = require("cors");
const multer  = require("multer");

const { analyzeDocument, zkpApi } = require("./orchestrator");

// ── APP SETUP ─────────────────────────────────────────────────────
const app    = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 }, // 50 MB max
});
const PORT   = process.env.PORT || 8000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ── HEALTH CHECK ──────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status:    "ok",
    system:    "DocuScan API Gateway v1.0",
    timestamp: new Date().toISOString(),
    architecture: "Backend → ZKP Engine → { Forensics, ML }",
    zkpEngine: zkpApi !== null,
  });
});

// ── MAIN ANALYZE ENDPOINT ─────────────────────────────────────────
// POST /api/analyze
// Accepts multipart/form-data with a file field named "file"
// Optional body field: "registrationId" for ZKP verification
app.post("/api/analyze", upload.single("file"), async (req, res) => {
  const startTime = Date.now();

  try {
    if (!req.file) {
      return res.status(400).json({
        error:   "No file provided",
        message: "Send a file as multipart/form-data with field name 'file'",
      });
    }

    const { buffer, originalname, mimetype, size } = req.file;
    const registrationId = req.body.registrationId || null;

    console.log(`\n📄 Analyzing: ${originalname} (${(size / 1024).toFixed(1)} KB, ${mimetype})`);

    // Delegate to ZKP engine (which orchestrates Forensics + ML internally)
    const result = await analyzeDocument(buffer, originalname, registrationId);

    const totalMs = Date.now() - startTime;
    console.log(`✅ Analysis complete in ${totalMs}ms — Score: ${result.trustScore} (${result.classification})`);

    res.json(result);

  } catch (err) {
    console.error("❌ Analysis failed:", err);
    res.status(500).json({
      error:   "Analysis failed",
      message: err.message,
    });
  }
});

// ── ZKP STANDALONE ENDPOINTS ──────────────────────────────────────

// POST /api/zkp/register — Register a document for ZKP integrity tracking
app.post("/api/zkp/register", upload.single("document"), async (req, res) => {
  try {
    if (!zkpApi) {
      return res.status(503).json({ error: "ZKP engine not available" });
    }
    if (!req.file && !req.body.document) {
      return res.status(400).json({ error: "No document provided" });
    }

    const fileBuffer = req.file
      ? req.file.buffer
      : Buffer.from(JSON.stringify(req.body.document));

    const version = req.body.version || "1";
    const result  = await zkpApi.registerDocument(fileBuffer, version);

    console.log(`🔐 ZKP Registered: ${result.registrationId}`);
    res.json(result);

  } catch (err) {
    console.error("❌ ZKP register error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/zkp/verify — Verify a document against a previous registration
app.post("/api/zkp/verify", upload.single("document"), async (req, res) => {
  try {
    if (!zkpApi) {
      return res.status(503).json({ error: "ZKP engine not available" });
    }

    const registrationId = req.body.registrationId;
    if (!registrationId) {
      return res.status(400).json({ error: "registrationId required" });
    }
    if (!req.file && !req.body.document) {
      return res.status(400).json({ error: "No document provided" });
    }

    const fileBuffer = req.file
      ? req.file.buffer
      : Buffer.from(JSON.stringify(req.body.document));

    const version = req.body.version || "1";
    const result  = await zkpApi.verifyDocument(fileBuffer, registrationId, version);

    console.log(`🔐 ZKP Verify: ${result.verdict} (Trust: ${result.trustScore})`);
    res.json(result);

  } catch (err) {
    console.error("❌ ZKP verify error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/zkp/status/:id — Check ZKP registration metadata
app.get("/api/zkp/status/:id", (req, res) => {
  if (!zkpApi) {
    return res.status(503).json({ error: "ZKP engine not available" });
  }
  res.json(zkpApi.getRegistrationStatus(req.params.id));
});

// ── ERROR HANDLING ────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── START SERVER ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║         DocuScan API Gateway — Running               ║
  ╚══════════════════════════════════════════════════════╝

  🌐  http://localhost:${PORT}

  Architecture:
    Frontend → Backend (here) → ZKP Engine → { Forensics, ML }

  Endpoints:
    POST /api/analyze          — Full analysis (delegated to ZKP engine)
    POST /api/zkp/register     — Register document for ZKP
    POST /api/zkp/verify       — Verify document via ZKP
    GET  /api/zkp/status/:id   — Check registration status
    GET  /api/health           — Health check
  `);
});
