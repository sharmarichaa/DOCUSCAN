/**
 * DocuScan — API End-to-End Test
 * Tests the /api/analyze endpoint with a real image file.
 */
const fs   = require("fs");
const path = require("path");
const http = require("http");

const FILE_PATH = path.join(__dirname, "test_loan_document.png");

if (!fs.existsSync(FILE_PATH)) {
  console.error("❌ Test file not found:", FILE_PATH);
  process.exit(1);
}

const fileBuffer = fs.readFileSync(FILE_PATH);
const fileName   = path.basename(FILE_PATH);
const boundary   = "----DocuScanTestBoundary" + Date.now();

// Build multipart/form-data body
const bodyParts = [];
bodyParts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: image/png\r\n\r\n`));
bodyParts.push(fileBuffer);
bodyParts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
const body = Buffer.concat(bodyParts);

console.log(`📤 Uploading: ${fileName} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);
console.log("⏳ Waiting for analysis...\n");

const req = http.request({
  hostname: "localhost",
  port:     8000,
  path:     "/api/analyze",
  method:   "POST",
  headers: {
    "Content-Type":   `multipart/form-data; boundary=${boundary}`,
    "Content-Length":  body.length,
  },
  timeout: 120_000,
}, (res) => {
  let data = "";
  res.on("data", chunk => data += chunk);
  res.on("end", () => {
    try {
      const result = JSON.parse(data);

      console.log("═══════════════════════════════════════════");
      console.log("  DOCUSCAN ANALYSIS RESULT");
      console.log("═══════════════════════════════════════════\n");

      console.log(`  Trust Score:    ${result.trustScore}/100`);
      console.log(`  Classification: ${result.classification}`);
      console.log();

      console.log("  Forensic Breakdown:");
      if (result.breakdown) {
        console.log(`    Pixel Splice:     ${result.breakdown.pixelSplice}`);
        console.log(`    Font Consistency: ${result.breakdown.fontConsistency}`);
        console.log(`    NLP Validation:   ${result.breakdown.nlpValidation}`);
        console.log(`    ZKP Integrity:    ${result.breakdown.zkpIntegrity}`);
      }
      console.log();

      console.log(`  Heatmap Regions:  ${result.heatmapRegions?.length || 0} found`);
      if (result.heatmapRegions?.length > 0) {
        result.heatmapRegions.forEach((r, i) => {
          console.log(`    Region ${i+1}: (${r.x}%, ${r.y}%) ${r.width}x${r.height}% [${r.severity}]`);
        });
      }
      console.log();

      console.log(`  Preview Images:   ${result.previewImages?.length || 0} generated`);
      console.log();

      if (result.meta) {
        console.log("  Engine Status:");
        console.log(`    Forensics: ${result.meta.enginesUsed?.forensics ? "✅ Ran" : "❌ Skipped"}`);
        console.log(`    ML Model:  ${result.meta.enginesUsed?.ml ? "✅ Ran" : "❌ Skipped"}`);
        console.log(`    ZKP:       ${result.meta.enginesUsed?.zkp ? "✅ Ran" : "❌ Skipped"}`);
        console.log(`    Time:      ${result.meta.processingTimeMs}ms`);
        if (result.meta.zkpRegistrationId) {
          console.log(`    ZKP Reg ID: ${result.meta.zkpRegistrationId}`);
        }
      }

      console.log("\n═══════════════════════════════════════════");
      console.log("  FULL JSON RESPONSE:");
      console.log("═══════════════════════════════════════════");

      // Print JSON but truncate base64 previews for readability
      const printable = { ...result };
      if (printable.previewImages?.length > 0) {
        printable.previewImages = printable.previewImages.map(
          (img) => img.slice(0, 50) + `... (${img.length} chars total)`
        );
      }
      console.log(JSON.stringify(printable, null, 2));

    } catch (e) {
      console.error("❌ Failed to parse response:", e.message);
      console.log("Raw response:", data.slice(0, 500));
    }
  });
});

req.on("error", (err) => {
  console.error("❌ Request failed:", err.message);
  console.error("   Make sure the backend is running: cd backend && npm run dev");
});

req.write(body);
req.end();
