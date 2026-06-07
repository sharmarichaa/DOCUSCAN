# ML Model Training — DocuScan

*The Python-based machine learning module for training document forgery detection models in DocuScan.*

## Overview

* This module is responsible for training and evaluating machine learning models capable of identifying forged or tampered documents.
* Focuses on detecting:
  * Clone stamping
  * Splicing
  * Regional document tampering
* The trained models will integrate with the Forensics Engine for real-time document verification and Trust Score generation.

## Detection Capabilities

| Factor | What it Detects |
|---|---|
| Splicing detection | Inserted or pasted regions from another document |
| Clone stamping detection | Duplicated regions copied within the same document |
| Tamper localization | Suspicious modified regions using segmentation masks |
| Heatmap generation | Visual representation of manipulated areas |
| Confidence analysis | Probability-based forgery prediction |

## Training Pipeline

* Dataset preprocessing
* Image augmentation
* Feature extraction
* Model training
* Tamper mask prediction
* Evaluation and validation
* Model export for backend integration

## Performance Goals

* Lightweight and efficient inference
* Optimized for integration with the C++ Forensics Engine
* Real-time compatible prediction pipeline

## Tech Stack

* Language: Python
* Deep Learning: PyTorch
* Computer Vision: OpenCV
* Segmentation Models: U-Net
* OCR Support: EasyOCR
* Data Processing: NumPy, Pandas
* Visualization: Matplotlib

## Planned Outputs

* Trained forgery detection model
* Tamper heatmaps
* Suspicious region masks
* Confidence scores


## Status

🛠 Currently building and training forgery detection models for SuRaksha Hackathon 2026