/**
 * DocuScan — Express REST Server
 * ─────────────────────────────────────────────────────────────────
 * Place this file inside scripts/ folder.
 *
 * Install:  npm install express cors multer
 * Run:      node scripts/server.js
 * API:      http://localhost:3001
 *
 * Endpoints:
 *   GET  /api/health              — health check
 *   POST /api/register            — register document (upload file)
 *   POST /api/verify              — verify document at disbursement
 *   GET  /api/status/:id          — check registration status
 */

"use strict";
const path    = require("path");
const express = require("express");
const cors    = require("cors");
const multer  = require("multer");

const { registerDocument, verifyDocument, getRegistrationStatus } =
  require("./zkp_api");

const app     = express();
const upload  = multer({ storage: multer.memoryStorage() }); // file stays in memory, never on disk
const PORT    = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit:"50mb" }));

// ── HEALTH CHECK ──────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status   : "ok",
    system   : "DocuScan ZKP v2.0",
    timestamp: new Date().toISOString(),
  });
});

// ── REGISTER DOCUMENT (at loan application) ───────────────────────────────
// Accepts multipart/form-data with a file field named "document"
app.post("/api/register", upload.single("document"), async (req, res) => {
  try {
    if (!req.file && !req.body.document) {
      return res.status(400).json({ error: "No document provided. Send file as multipart or JSON." });
    }

    // Accept file upload OR raw JSON document object
    const fileBuffer = req.file
      ? req.file.buffer
      : Buffer.from(JSON.stringify(req.body.document));

    const version = req.body.version || "1";
    const result  = await registerDocument(fileBuffer, version);
    res.json(result);

  } catch (e) {
    console.error("Register error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── VERIFY DOCUMENT (at disbursement) ────────────────────────────────────
// Accepts multipart/form-data with file + registrationId
app.post("/api/verify", upload.single("document"), async (req, res) => {
  try {
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
    const result  = await verifyDocument(fileBuffer, registrationId, version);
    res.json(result);

  } catch (e) {
    console.error("Verify error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET REGISTRATION STATUS ───────────────────────────────────────────────
app.get("/api/status/:id", (req, res) => {
  res.json(getRegistrationStatus(req.params.id));
});

// ── START ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  DocuScan ZKP API running at http://localhost:${PORT}

  POST /api/register   — upload document at loan application
  POST /api/verify     — verify document at disbursement
  GET  /api/status/:id — check registration metadata
  GET  /api/health     — health check

  All document content stays local. Nothing stored or transmitted.
  `);
});
