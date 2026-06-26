# Forensics Engine — DocuScan

The core C++ engine powering DocuScan's document forgery detection pipeline.

## Overview
Analyzes documents at pixel and text level to detect signs of tampering. Outputs a Trust Score (0-100) with full breakdown and exact coordinates of suspicious regions.

## Detection Capabilities

| Factor | Weight | What it Detects |
|--------|--------|-----------------|
| Splicing (ELA) | 25% | Pixel-level tampering, copy-paste from another image |
| Uniform Overlay | 15% | Solid box pasted over original content |
| Font Consistency | 20% | Font mismatches across document regions |
| NLP Verification | 15% | Inconsistencies in names, dates and figures |
| Metadata Analysis | 15% | Traces of editing software in EXIF data |
| Clone Stamping | 10% | Duplicate regions copy-pasted within same document |

## Tech Stack
- Language: C++17
- Image processing: OpenCV
- OCR: Tesseract
- PDF support: Poppler
- Metadata: Binary EXIF parsing

## Dependencies (MSYS2 MinGW64)
```bash
pacman -S mingw-w64-x86_64-opencv mingw-w64-x86_64-tesseract-ocr mingw-w64-x86_64-poppler mingw-w64-x86_64-pkg-config
```

## Build
```bash
g++ -std=c++17 -O2 analyzer.cpp -o analyzer $(pkg-config --cflags --libs opencv4) $(pkg-config --cflags --libs tesseract) $(pkg-config --cflags --libs poppler-cpp) -lstdc++fs
```

## Run
```bash
./analyzer document.jpg
./analyzer document.pdf
```

## Output

| Score | Status |
|-------|--------|
| 75 - 100 | SAFE |
| 50 - 74 | SUSPICIOUS |
| 0 - 49 | REJECT |

Two image files are saved after each run:
- `heatmap.jpg` — ELA heatmap showing compression anomalies
- `overlay.jpg` — Original document with tampered regions highlighted

Sample JSON output:
```json
{
  "trustScore": 85.2,
  "status": "SAFE",
  "processingTimeMs": 1200,
  "scores": {
    "splicing": 90.1,
    "clone": 100,
    "uniformOverlay": 80.0,
    "font": 100,
    "nlp": 100,
    "metadata": 100
  },
  "regions": []
}
```
