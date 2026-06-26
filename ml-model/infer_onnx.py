import cv2
import json
import time
import sys
import numpy as np
import onnxruntime as ort


if len(sys.argv) != 2:
    print("Usage: python infer_onnx.py <image_path>")
    sys.exit(1)

IMAGE_PATH = sys.argv[1]


# --------------------------------------------------
# FIND SUSPICIOUS REGIONS
# --------------------------------------------------

def get_regions(pred):

    binary = (pred > 0.5).astype(np.uint8)

    contours, _ = cv2.findContours(
        binary,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE
    )

    regions = []

    for contour in contours:

        x, y, w, h = cv2.boundingRect(contour)

        area = w * h

        if area < 150:
            continue

        confidence = float(
            pred[y:y+h, x:x+w].max()
        )

        regions.append({
            "x": int(x),
            "y": int(y),
            "w": int(w),
            "h": int(h),
            "type": "splicing",
            "confidence": round(confidence, 3)
        })

    return regions


# --------------------------------------------------
# START TIMER
# --------------------------------------------------

start_time = time.time()


# --------------------------------------------------
# LOAD ONNX MODEL
# --------------------------------------------------

session = ort.InferenceSession(
    "docuscan_model.onnx",
    providers=["CPUExecutionProvider"]
)

input_name = session.get_inputs()[0].name

print("✅ ONNX Model Loaded Successfully")


# --------------------------------------------------
# LOAD IMAGE
# --------------------------------------------------

img = cv2.imread(IMAGE_PATH)

if img is None:
    raise Exception("Image not found")

img = cv2.resize(img, (256, 256))

img = img.astype(np.float32) / 255.0

tensor = np.transpose(img, (2, 0, 1))
tensor = np.expand_dims(tensor, axis=0)


# --------------------------------------------------
# INFERENCE
# --------------------------------------------------

pred = session.run(
    None,
    {input_name: tensor}
)[0]

pred = pred.squeeze()


# --------------------------------------------------
# PREDICTION STATS
# --------------------------------------------------

print("\nPrediction Statistics")
print("---------------------")
print("Min :", pred.min())
print("Max :", pred.max())
print("Mean:", pred.mean())


# --------------------------------------------------
# REGIONS
# --------------------------------------------------

regions = get_regions(pred)


# --------------------------------------------------
# SPLICING SCORE
# --------------------------------------------------

if len(regions) == 0:

    splicing_score = 0

else:

    max_conf = max(
        region["confidence"]
        for region in regions
    )

    total_area = sum(
        region["w"] * region["h"]
        for region in regions
    )

    area_factor = min(
        total_area / 300,
        1.0
    )

    splicing_score = (
        max_conf * 100 * area_factor
    )


# --------------------------------------------------
# TRUST SCORE
# --------------------------------------------------

trust_score = max(
    0,
    100 - splicing_score
)


# --------------------------------------------------
# STATUS
# --------------------------------------------------

if trust_score >= 75:

    status = "VERIFIED"

elif trust_score >= 40:

    status = "REVIEW"

else:

    status = "REJECT"


# --------------------------------------------------
# PROCESSING TIME
# --------------------------------------------------

processing_ms = int(
    (time.time() - start_time) * 1000
)


# --------------------------------------------------
# JSON OUTPUT
# --------------------------------------------------

output = {

    "trustScore": round(
        trust_score,
        2
    ),

    "status": status,

    "processingTimeMs": processing_ms,

    "scores": {

        "splicing": round(
            splicing_score,
            2
        ),

        "clone": 0,

        "ocr": 0
    },

    "regions": regions
}

print("\nJSON Output")
print("-----------")

print(
    json.dumps(
        output,
        indent=4
    )
)