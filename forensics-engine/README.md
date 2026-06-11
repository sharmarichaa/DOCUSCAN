# Forensics Engine — DocuScan

The core C++ engine powering DocuScan's document forgery detection pipeline.

## Overview
This module analyzes documents at pixel and text level to detect signs of tampering. Outputs Trust Score (0-100) with breakdown of suspicion.

## Detection Capabilities
| Factor | What it Detects |
|--------|------------------|
| Pixel-level integrity | Splicing, clone stamping, regional modifications |
| Font consistency | Font mismatches across document regions |
| NLP verification | Inconsistencies in names, figures and dates |
| Metadata analysis | Traces of editing software or re-saving |

## Output
- Trust Score (0-100)
- JSON formatted results
- Heatmap image (heatmap.jpg)
- Tamper overlay (overlay.jpg)

## Tech Stack
- Language: C++17
- Image processing: OpenCV
- OCR: Tesseract
- Metadata: Built-in OpenCV

## Build & Run
```bash
g++ analyzer.cpp -o analyzer -std=c++17 -IC:/msys64/mingw64/include/opencv4 -IC:/msys64/mingw64/include -LC:/msys64/mingw64/lib -lopencv_core -lopencv_imgcodecs -lopencv_imgproc -ltesseract

./analyzer.exe
