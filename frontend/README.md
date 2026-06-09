# DOCUSCAN Underwriter Dashboard

This is the frontend component for the DOCUSCAN project, providing a premium, highly-interactive interface for underwriters to analyze documents for tampering using advanced Forensics and Zero-Knowledge Proofs (ZKP).

## Tech Stack
- **Framework**: React 18 with Vite
- **Language**: TypeScript
- **Styling**: Vanilla CSS Modules (Dark mode, Glassmorphism design system)
- **Icons**: Lucide React

## Architecture & Integration Workflow

Because the frontend runs strictly within the browser, it cannot execute the C++ Forensics Engine or the Circom/SnarkJS ZKP environment directly. The complete system architecture relies on an **API Gateway** bridging the UI and the backend engines.

### The Complete Workflow

1. **Upload**: The user uploads a document (PDF, PNG, JPG) via the frontend drag-and-drop interface.
2. **Transmission**: The frontend posts this file via `multipart/form-data` to your backend API Gateway.
3. **Backend Orchestration (Your API Gateway)**:
   - *Image Conversion*: Converts the PDF into page-by-page images for the frontend preview.
   - *ML Training/Inference*: Runs the Python ML scripts to detect anomalies.
   - *Forensics Engine*: Spawns the C++ executable to run pixel-level and font-level checks.
   - *ZKP Verification*: Executes SnarkJS to verify the document hash against the original submitted proof.
4. **Response**: The API Gateway aggregates these results into a standardized JSON response.
5. **Rendering**: The frontend receives the JSON, updates the Trust Gauge, populates the Forensic Breakdown, and perfectly overlays dynamic heatmaps over the original document image.

## How to Link the Backend Engines

Currently, the frontend uses a mock service stub located at `src/services/api.ts`. To link your real engines, follow these steps:

### 1. Build the API Gateway
Create a simple server (e.g., Python FastAPI or Node.js Express). This server must expose an endpoint like `POST /api/analyze`. 
This endpoint should save the uploaded file temporarily, run your C++ and SnarkJS CLI commands via child processes (or FFI bindings), parse their console output, and return the required JSON format.

### 2. The JSON Contract
Your API must return a JSON object matching the `AnalysisResponse` interface defined in `api.ts`.
Example:
```json
{
  "trustScore": 32,
  "classification": "SUSPICIOUS",
  "heatmapRegions": [
    { "pageIndex": 0, "x": 55, "y": 70, "width": 30, "height": 12, "severity": "high" },
    { "pageIndex": 1, "x": 15, "y": 20, "width": 25, "height": 5, "severity": "medium" }
  ],
  "breakdown": {
    "pixelSplice": "Detected",
    "fontConsistency": "Passed",
    "nlpValidation": "Passed",
    "zkpIntegrity": "Mismatch from origin"
  },
  "previewImages": ["data:image/png;base64,..."]
}
```
*(Note: Heatmap `x`, `y`, `width`, and `height` must be percentages (0-100) relative to the document page size so they scale perfectly on any screen).*

### 3. Update the Frontend Service
Open `src/services/api.ts` and replace the mock `analyzeDocument` function with a real HTTP request:

```typescript
export const analyzeDocument = async (file: File): Promise<AnalysisResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('http://localhost:8000/api/analyze', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Analysis failed');
  }

  return await response.json();
};
```

## Security

This frontend enforces a strict **Content Security Policy (CSP)** to prevent external data leaks. Data will only be transmitted to the origin server.

## Local Development

To run the frontend locally:
```bash
npm install
npm run dev
```
