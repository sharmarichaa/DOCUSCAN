# Forensics Engine — DocuScan

The core C++ engine powering DocuScan's document forgery detection pipeline.

## Overview
This module analyzes documents at a pixel and text level to detect signs of tampering. It outputs a Trust Score from 0–100 with a breakdown of exactly where and why suspicion was flagged.

## Detection Capabilities

| Factor | What it Detects |
|---|---|
| Pixel-level integrity | Splicing, clone stamping, regional modifications |
| Font consistency | Font mismatches across document regions |
| NLP verification | Inconsistencies in names, figures and dates |
| Metadata analysis | Traces of editing software or re-saving |
| ZKP hash match | Whether document matches its originally submitted proof |

## Performance Target
- Processes a standard PDF in under 200ms

## Tech Stack
- Language: C++
- Image processing: OpenCV
- OCR: Tesseract
- NLP: spaCy (Python bridge)



## Status
🚧 In active development — SuRaksha Hackathon 2026
