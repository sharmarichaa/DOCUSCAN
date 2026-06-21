# DocuScan Vision Model

A deep learning model for pixel-level document forgery localization using semantic segmentation.

This repository contains the ONNX inference model used to identify visually manipulated regions in scanned document images. The model predicts tampered regions and returns structured JSON output that can be consumed by downstream verification systems.

---

## Overview

The model performs semantic segmentation to identify suspicious image regions that may indicate document tampering such as image splicing or localized pixel manipulation.

The inference pipeline generates:

- Pixel-level forgery prediction
- Suspicious region localization
- Confidence estimation
- Trust score calculation
- Structured JSON output

---

## Model Information

| Property | Value |
|----------|-------|
| Architecture | U-Net |
| Framework | PyTorch |
| Export Format | ONNX |
| Runtime | ONNX Runtime |
| Input Size | 256 × 256 RGB |
| Input Type | Document Image |
| Output | Pixel-wise Tampering Probability Map |

---

## Repository Structure

```
.
├── docuscan_model.onnx
├── docuscan_model.onnx.data
├── infer_onnx.py
├── requirements.txt
└── README.md
```

---

## Installation

Clone the repository

```bash
git clone <repository-url>
cd <repository-name>
```

Install dependencies

```bash
pip install -r requirements.txt
```

---

## Usage

Run inference on a document image.

```bash
python infer_onnx.py path/to/document.jpg
```

Example

```bash
python infer_onnx.py sample.jpg
```

---

## Input

Supported formats

- JPG
- JPEG
- PNG

The input image is resized internally to **256 × 256** before inference.

---

## Output

The inference script returns a JSON response containing the overall document assessment and localized suspicious regions.

Example

```json
{
    "trustScore": 91.42,
    "status": "VERIFIED",
    "processingTimeMs": 132,
    "scores": {
        "splicing": 8.58,
        "clone": 0,
        "ocr": 0
    },
    "regions": [
        {
            "x": 124,
            "y": 83,
            "w": 38,
            "h": 26,
            "type": "splicing",
            "confidence": 0.91
        }
    ]
}
```

---

## Output Fields

| Field | Description |
|--------|-------------|
| trustScore | Overall document confidence score (0–100) |
| status | Verification status |
| processingTimeMs | Inference latency |
| scores.splicing | Estimated splicing confidence |
| regions | Localized suspicious regions |

---

## Status Labels

| Status | Meaning |
|---------|---------|
| VERIFIED | No significant visual tampering detected |
| REVIEW | Suspicious regions detected that require manual verification |
| REJECT | High confidence of document manipulation |

---

## Dependencies

- Python 3.10+
- OpenCV
- NumPy
- ONNX Runtime

---

## Notes

- The model performs visual forgery localization only.
- Inference is optimized for CPU execution using ONNX Runtime.

---

## License

This project was developed as part of the **SuRaksha Cyber Hackathon**.