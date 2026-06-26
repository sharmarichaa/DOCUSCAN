#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <future>
#include <iostream>
#include <leptonica/allheaders.h>
#include <map>
#include <numeric>
#include <opencv2/core.hpp>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <poppler/cpp/poppler-document.h>
#include <poppler/cpp/poppler-page-renderer.h>
#include <poppler/cpp/poppler-page.h>
#include <regex>
#include <set>
#include <tesseract/baseapi.h>
#include <tuple>
#include <vector>

using namespace std;
using namespace cv;
namespace fs = std::filesystem;
struct TamperRegion {
  int x, y, w, h;
  string type;
  float confidence;
};

struct EngineResult {
  float trustScore;
  float splicingScore;
  float cloneScore;
  float uniformOverlayScore;
  float fontScore;
  float nlpScore;
  float metadataScore;
  float noiseScore;
  float doubleJpegScore;
  float textNoiseScore;
  string status;
  vector<TamperRegion> regions;
  long long processingTimeMs;
};

// F0 - PDF TO IMAGE

Mat pdfToMat(const string &pdfPath) {
  auto doc = poppler::document::load_from_file(pdfPath);
  if (!doc || doc->pages() == 0) {
    cerr << "[PDF] Failed to load: " << pdfPath << endl;
    return Mat();
  }

  poppler::page *page = doc->create_page(0);
  if (!page) {
    cerr << "[PDF] Failed to get page 0" << endl;
    return Mat();
  }

  poppler::page_renderer renderer;
  renderer.set_render_hint(poppler::page_renderer::antialiasing, true);
  renderer.set_render_hint(poppler::page_renderer::text_antialiasing, true);

  poppler::image img = renderer.render_page(page, 150, 150);
  if (!img.is_valid()) {
    cerr << "[PDF] Render failed" << endl;
    return Mat();
  }

  Mat result(img.height(), img.width(), CV_8UC3);
  const char *data = img.const_data();

  for (int row = 0; row < img.height(); row++) {
    for (int col = 0; col < img.width(); col++) {
      int idx = (row * img.width() + col) * 4;
      result.at<Vec3b>(row, col)[0] = (uchar)data[idx + 3]; // B
      result.at<Vec3b>(row, col)[1] = (uchar)data[idx + 2]; // G
      result.at<Vec3b>(row, col)[2] = (uchar)data[idx + 1]; // R
    }
  }

  return result;
}

// F1 - ELA (Splicing Detection)

Mat computeELA(const Mat &image, int quality = 95) {
  vector<uchar> buf;
  vector<int> params = {IMWRITE_JPEG_QUALITY, quality};
  imencode(".jpg", image, buf, params);
  Mat compressed = imdecode(buf, IMREAD_COLOR);
  Mat ela;
  absdiff(image, compressed, ela);
  Mat elaGray;
  cvtColor(ela, elaGray, COLOR_BGR2GRAY);
  elaGray *= 10;
  Mat elaNormalized;
  normalize(elaGray, elaNormalized, 0, 255, NORM_MINMAX);
  return elaNormalized;
}

float getSplicingScore(const Mat &elaImage, vector<TamperRegion> &regions) {
  Scalar mean, stddev;
  meanStdDev(elaImage, mean, stddev);

  Mat thresholded;
  double threshold = mean[0] + 1.5 * stddev[0];
  cv::threshold(elaImage, thresholded, threshold, 255, THRESH_BINARY);

  vector<vector<Point>> contours;
  findContours(thresholded, contours, RETR_EXTERNAL, CHAIN_APPROX_SIMPLE);

  int imageArea = elaImage.rows * elaImage.cols;
  int suspiciousArea = 0;

  for (auto &contour : contours) {
    Rect bbox = boundingRect(contour);
    int area = bbox.width * bbox.height;
    if (area > 500) {
      suspiciousArea += area;
      TamperRegion r;
      r.x = bbox.x;
      r.y = bbox.y;
      r.w = bbox.width;
      r.h = bbox.height;
      r.type = "splicing";
      r.confidence = min(100.0f, (float)(area * 100) / imageArea);
      regions.push_back(r);
    }
  }

  float suspiciousRatio = (float)suspiciousArea / imageArea;

  float score = 100.0f - (suspiciousRatio * 300.0f);
  return max(0.0f, min(100.0f, score));
}

// F2 - Uniform Overlay Detection

float getUniformOverlayScore(const Mat &image, vector<TamperRegion> &regions) {
  Mat gray;
  cvtColor(image, gray, COLOR_BGR2GRAY);

  int blockSize = 20;
  int imageArea = gray.rows * gray.cols;
  int suspiciousArea = 0;

  Mat suspicionMap = Mat::zeros(gray.size(), CV_8U);

  for (int y = 0; y <= gray.rows - blockSize; y += blockSize) {
    for (int x = 0; x <= gray.cols - blockSize; x += blockSize) {
      Rect roi(x, y, blockSize, blockSize);
      Mat block = gray(roi);
      Scalar mean, stddev;
      meanStdDev(block, mean, stddev);

      if (stddev[0] < 8.0 && mean[0] > 200) {
        suspiciousArea += blockSize * blockSize;
        suspicionMap(roi).setTo(255);
      }
    }
  }

  vector<vector<Point>> contours;
  Mat dilated;
  dilate(suspicionMap, dilated, Mat(), Point(-1, -1), 3);
  findContours(dilated, contours, RETR_EXTERNAL, CHAIN_APPROX_SIMPLE);

  for (auto &contour : contours) {
    Rect bbox = boundingRect(contour);
    int area = bbox.width * bbox.height;
    if (area > 2000) {
      TamperRegion r;
      r.x = bbox.x;
      r.y = bbox.y;
      r.w = bbox.width;
      r.h = bbox.height;
      r.type = "uniform_overlay";
      r.confidence = min(100.0f, (float)(area * 100) / imageArea * 5);
      regions.push_back(r);
    }
  }

  float ratio = (float)suspiciousArea / imageArea;
  float score = 100.0f - (ratio * 400.0f);
  return max(0.0f, min(100.0f, score));
}

// F3 - Clone Stamping Detection (Block Hash Matching)

float getCloneScore(const Mat &image, vector<TamperRegion> &regions) {
  Mat gray;
  cvtColor(image, gray, COLOR_BGR2GRAY);
  GaussianBlur(gray, gray, Size(3, 3), 0);

  int blockSize = 16;
  map<size_t, vector<Rect>> hashMap;

  for (int y = 0; y <= gray.rows - blockSize; y += blockSize) {
    for (int x = 0; x <= gray.cols - blockSize; x += blockSize) {
      Rect blockRect(x, y, blockSize, blockSize);
      Mat block = gray(blockRect);

      Mat small;
      resize(block, small, Size(8, 8));

      Scalar mean = cv::mean(small);
      double avg = mean[0];

      size_t hash = 0;
      for (int i = 0; i < 8; i++) {
        for (int j = 0; j < 8; j++) {
          hash <<= 1;
          if (small.at<uchar>(i, j) > avg)
            hash |= 1;
        }
      }
      hashMap[hash].push_back(blockRect);
    }
  }

  int clonePairCount = 0;
  for (auto &entry : hashMap) {
    vector<Rect> &blocks = entry.second;
    if (blocks.size() >= 2) {
      for (size_t i = 0; i < blocks.size() && i < 5; i++) {
        for (size_t j = i + 1; j < blocks.size() && j < 5; j++) {
          Point c1(blocks[i].x + blockSize / 2, blocks[i].y + blockSize / 2);
          Point c2(blocks[j].x + blockSize / 2, blocks[j].y + blockSize / 2);
          double dist = norm(c1 - c2);
          if (dist > blockSize * 4) {
            clonePairCount++;
            if (clonePairCount <= 20) {
              TamperRegion r;
              r.x = blocks[i].x;
              r.y = blocks[i].y;
              r.w = blockSize;
              r.h = blockSize;
              r.type = "clone";
              r.confidence = 60.0f;
              regions.push_back(r);
            }
          }
        }
      }
    }
  }

  float penalty = max(0.0f, (float)(clonePairCount - 30) * 0.5f);
  return max(0.0f, min(100.0f, 100.0f - penalty));
}

struct OCRData {
  string text;
  map<int, vector<float>> zoneHeights;
  vector<Rect> wordBoxes;
};

OCRData performOCR(const Mat &image) {
  OCRData data;
  tesseract::TessBaseAPI ocr;
  if (ocr.Init(NULL, "eng", tesseract::OEM_LSTM_ONLY) != 0)
    return data;

  ocr.SetVariable("tessedit_do_invert", "0");

  Mat gray;
  cvtColor(image, gray, COLOR_BGR2GRAY);

  Mat processed = gray;
  if (gray.cols > 600) {
    float scale = 600.0f / gray.cols;
    resize(gray, processed, Size(), scale, scale);
  }

  Mat sharpened;
  GaussianBlur(processed, sharpened, Size(0, 0), 3);
  addWeighted(processed, 1.5, sharpened, -0.5, 0, sharpened);

  ocr.SetImage(sharpened.data, sharpened.cols, sharpened.rows, 1,
               sharpened.step);

  char *out = ocr.GetUTF8Text();
  data.text = string(out);
  delete[] out;

  tesseract::ResultIterator *ri = ocr.GetIterator();
  tesseract::PageIteratorLevel level = tesseract::RIL_WORD;
  int zoneHeight = sharpened.rows / 3;

  if (ri) {
    do {
      int x1, y1, x2, y2;
      if (ri->BoundingBox(level, &x1, &y1, &x2, &y2)) {
        float h = y2 - y1;
        float w = x2 - x1;
        if (h > 6 && w > 6 && h < 100) {
          int zone = y1 / zoneHeight;
          data.zoneHeights[zone].push_back(h);
          data.wordBoxes.push_back(Rect(x1, y1, (int)w, (int)h));
        }
      }
    } while (ri->Next(level));
    delete ri;
  }

  ocr.End();
  return data;
}

// F4 - Font Consistency

float getFontConsistencyScore(const map<int, vector<float>> &zoneHeights) {
  if (zoneHeights.empty())
    return 70.0f;

  float score = 100.0f;
  int tooUniformZones = 0;
  int totalZones = 0;

  for (const auto &zone : zoneHeights) {
    const vector<float> &heights = zone.second;
    if (heights.size() < 3)
      continue;

    totalZones++;

    float mean =
        accumulate(heights.begin(), heights.end(), 0.0f) / heights.size();
    float variance = 0;
    for (float h : heights)
      variance += (h - mean) * (h - mean);
    variance /= heights.size();
    float stddev = sqrt(variance);

    float cv = stddev / (mean + 0.01f);

    if (cv > 0.5f)
      score -= 20;
    else if (cv > 0.35f)
      score -= 8;

    if (cv < 0.03f && heights.size() >= 5) {
      tooUniformZones++;
      score -= 15;
    } else if (cv < 0.06f && heights.size() >= 4) {
      tooUniformZones++;
      score -= 8;
    }
  }

  if (tooUniformZones >= 2)
    score -= 15;

  return max(0.0f, score);
}

// F5 - NLP Cross Validation

struct ExtractedData {
  vector<string> dates;
  vector<float> amounts;
  vector<string> names;
};

ExtractedData extractFromText(const string &text) {
  ExtractedData data;
  smatch match;
  string temp;

  regex dateRegex(R"(\b(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})\b)");
  temp = text;
  while (regex_search(temp, match, dateRegex)) {
    data.dates.push_back(match[1]);
    temp = match.suffix();
  }

  regex amountRegex(R"((?:[₹RsINR]+\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?))");
  temp = text;
  while (regex_search(temp, match, amountRegex)) {
    string amtStr = match[1];
    amtStr.erase(remove(amtStr.begin(), amtStr.end(), ','), amtStr.end());
    try {
      data.amounts.push_back(stof(amtStr));
    } catch (...) {
    }
    temp = match.suffix();
  }

  regex nameRegex(
      R"((?:Name|Applicant|Borrower|Shri|Smt)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*))");
  temp = text;
  while (regex_search(temp, match, nameRegex)) {
    data.names.push_back(match[1]);
    temp = match.suffix();
  }

  return data;
}

string getOCRText(const Mat &image) {
  tesseract::TessBaseAPI ocr;
  if (ocr.Init(NULL, "eng") != 0)
    return "";

  Mat gray;
  cvtColor(image, gray, COLOR_BGR2GRAY);
  Mat sharpened;
  GaussianBlur(gray, sharpened, Size(0, 0), 3);
  addWeighted(gray, 1.5, sharpened, -0.5, 0, sharpened);

  ocr.SetImage(sharpened.data, sharpened.cols, sharpened.rows, 1,
               sharpened.step);
  char *out = ocr.GetUTF8Text();
  string text(out);
  delete[] out;
  ocr.End();
  return text;
}

float getNLPScore(const string &text) {
  if (text.empty())
    return 70.0f;

  ExtractedData data = extractFromText(text);
  float score = 100.0f;

  if (data.dates.size() > 1) {
    int ddmmyyyy = 0, ddmmyy = 0;
    for (auto &d : data.dates) {
      if (d.length() == 10)
        ddmmyyyy++;
      else if (d.length() == 8)
        ddmmyy++;
    }
    if (ddmmyyyy > 0 && ddmmyy > 0)
      score -= 20;
  }

  if (data.names.size() >= 2) {
    set<string> uniqueNames(data.names.begin(), data.names.end());
    if (uniqueNames.size() > 1) {
      score -= 30;
    }
  }

  int roundAmounts = 0;
  for (float amt : data.amounts) {
    if (amt > 100000 && fmod(amt, 10000) == 0)
      roundAmounts++;
  }
  if (roundAmounts > 2)
    score -= 10;

  return max(0.0f, score);
}

// F6 - Metadata Analysis (EXIF via binary parsing)

float getMetadataScore(const string &filePath) {
  float score = 100.0f;

  ifstream file(filePath, ios::binary);
  if (!file.is_open())
    return 70.0f;

  vector<char> buffer(65536);
  file.read(buffer.data(), buffer.size());
  streamsize bytesRead = file.gcount();
  file.close();

  string content(buffer.data(), bytesRead);

  vector<string> suspiciousTools = {
      "Adobe Photoshop",  "GIMP",       "Paint.NET", "Pixelmator",
      "Snapseed",         "Lightroom",  "Canva",     "PicsArt",
      "Microsoft Office", "LibreOffice"};

  for (const string &tool : suspiciousTools) {
    if (content.find(tool) != string::npos) {
      score -= 40;
      break;
    }
  }

  int soiCount = 0;
  for (size_t i = 0; i + 1 < (size_t)bytesRead; i++) {
    if ((unsigned char)buffer[i] == 0xFF &&
        (unsigned char)buffer[i + 1] == 0xD8) {
      soiCount++;
    }
  }
  if (soiCount > 1)
    score -= 25;

  if (content.find("PNG") != string::npos &&
      filePath.find(".jpg") != string::npos) {
    score -= 20;
  }

  return max(0.0f, score);
}

// F7 - Noise Inconsistency Detection (catches Canva/synthetic edits)

float getNoiseScore(const Mat &image, vector<TamperRegion> &regions) {
  Mat gray;
  cvtColor(image, gray, COLOR_BGR2GRAY);

  Mat laplacian;
  Laplacian(gray, laplacian, CV_64F, 3);
  Mat absLap;
  convertScaleAbs(laplacian, absLap);

  int blockSize = 32;
  vector<double> blockNoises;
  vector<Rect> blockRects;

  for (int y = 0; y <= gray.rows - blockSize; y += blockSize / 2) {
    for (int x = 0; x <= gray.cols - blockSize; x += blockSize / 2) {
      Rect roi(x, y, blockSize, blockSize);
      Mat block = absLap(roi);
      Scalar mean, stddev;
      meanStdDev(block, mean, stddev);
      blockNoises.push_back(stddev[0]);
      blockRects.push_back(roi);
    }
  }

  if (blockNoises.empty()) return 100.0f;

  double globalMean = 0, globalStd = 0;
  for (double n : blockNoises) globalMean += n;
  globalMean /= blockNoises.size();
  for (double n : blockNoises) globalStd += (n - globalMean) * (n - globalMean);
  globalStd = sqrt(globalStd / blockNoises.size());

  int suspiciousBlocks = 0;
  int totalBlocks = (int)blockNoises.size();
  float score = 100.0f;

  for (size_t i = 0; i < blockNoises.size(); i++) {
    if (globalMean > 5.0 && blockNoises[i] < globalMean * 0.25) {
      suspiciousBlocks++;
      if (blockNoises[i] < globalMean * 0.15 && blockRects[i].width > 16) {
        TamperRegion r;
        r.x = blockRects[i].x;
        r.y = blockRects[i].y;
        r.w = blockRects[i].width;
        r.h = blockRects[i].height;
        r.type = "noise_anomaly";
        r.confidence = min(100.0f, (float)((globalMean - blockNoises[i]) / globalMean * 100));
        regions.push_back(r);
      }
    }
    if (globalMean > 3.0 && blockNoises[i] > globalMean * 3.0) {
      suspiciousBlocks++;
    }
  }

  float noiseCV = (globalMean > 0.01f) ? (float)(globalStd / globalMean) : 0.0f;

  if (noiseCV > 0.8f) score -= 40;
  else if (noiseCV > 0.6f) score -= 25;
  else if (noiseCV > 0.45f) score -= 15;
  else if (noiseCV > 0.35f) score -= 8;

  float suspiciousRatio = (float)suspiciousBlocks / totalBlocks;
  if (suspiciousRatio > 0.10f) score -= 30;
  else if (suspiciousRatio > 0.05f) score -= 20;
  else if (suspiciousRatio > 0.02f) score -= 10;
  else if (suspiciousRatio > 0.01f) score -= 5;

  return max(0.0f, min(100.0f, score));
}

// F8 - Double JPEG Compression Detection

float getDoubleJpegScore(const Mat &image) {
  Mat gray;
  cvtColor(image, gray, COLOR_BGR2GRAY);

  vector<double> errors;
  for (int q = 50; q <= 98; q += 2) {
    vector<uchar> buf;
    vector<int> params = {IMWRITE_JPEG_QUALITY, q};
    imencode(".jpg", gray, buf, params);
    Mat recompressed = imdecode(buf, IMREAD_GRAYSCALE);
    Mat diff;
    absdiff(gray, recompressed, diff);
    Scalar mean = cv::mean(diff);
    errors.push_back(mean[0]);
  }

  if (errors.size() < 5) return 100.0f;

  int nonMonotonic = 0;
  for (size_t i = 1; i < errors.size() - 1; i++) {
    if (errors[i] < errors[i-1] && errors[i] < errors[i+1])
      nonMonotonic++;
    if (i > 0 && errors[i] > errors[i-1] * 1.15)
      nonMonotonic++;
  }

  double highQualityError = errors.back();
  double midQualityError = errors[errors.size()/2];
  double errorRatio = (midQualityError > 0.01) ? highQualityError / midQualityError : 1.0;

  float score = 100.0f;

  if (nonMonotonic >= 4) score -= 35;
  else if (nonMonotonic >= 2) score -= 20;
  else if (nonMonotonic >= 1) score -= 10;

  if (errorRatio > 0.85) score -= 15;
  else if (errorRatio > 0.7) score -= 8;

  return max(0.0f, min(100.0f, score));
}

// F9 - Text Region vs Background Noise Comparison

float getTextNoiseScore(const Mat &image, const vector<Rect> &wordBoxes,
                        vector<TamperRegion> &regions) {
  if (wordBoxes.empty()) return 80.0f;

  Mat gray;
  cvtColor(image, gray, COLOR_BGR2GRAY);

  Mat laplacian;
  Laplacian(gray, laplacian, CV_64F, 3);
  Mat absLap;
  convertScaleAbs(laplacian, absLap);

  Scalar globalMean = cv::mean(absLap);
  double bgNoiseMean = globalMean[0];

  if (bgNoiseMean < 2.0) return 100.0f;

  int syntheticTextCount = 0;
  int analyzedBoxes = 0;
  float totalRatio = 0;

  for (const Rect &box : wordBoxes) {
    if (box.width < 8 || box.height < 5) continue;
    if (box.x < 0 || box.y < 0 || box.x + box.width > gray.cols ||
        box.y + box.height > gray.rows)
      continue;

    analyzedBoxes++;

    Mat textRegion = absLap(box);
    Scalar textMean = cv::mean(textRegion);
    double textNoiseMean = textMean[0];

    int expand = max(box.width, box.height);
    int sx = max(0, box.x - expand);
    int sy = max(0, box.y - expand);
    int sw = min(gray.cols - sx, box.width + 2 * expand);
    int sh = min(gray.rows - sy, box.height + 2 * expand);
    Rect surroundBox(sx, sy, sw, sh);

    Mat surroundRegion = absLap(surroundBox);
    Scalar surroundMean = cv::mean(surroundRegion);
    double surroundNoiseMean = surroundMean[0];

    if (surroundNoiseMean < 1.0) continue;

    double ratio = textNoiseMean / surroundNoiseMean;
    totalRatio += (float)ratio;

    if (ratio < 0.5 || ratio > 1.5) {
      syntheticTextCount++;
      TamperRegion r;
      r.x = box.x;
      r.y = box.y;
      r.w = box.width;
      r.h = box.height;
      r.type = "synthetic_text";
      r.confidence = min(100.0f, (float)(abs(1.0 - ratio) * 100));
      regions.push_back(r);
    }
  }

  if (analyzedBoxes == 0) return 80.0f;

  float avgRatio = totalRatio / analyzedBoxes;
  float syntheticFraction = (float)syntheticTextCount / analyzedBoxes;


  float score = 100.0f;

  if (syntheticFraction > 0.4f) score -= 40;
  else if (syntheticFraction > 0.2f) score -= 25;
  else if (syntheticFraction > 0.1f) score -= 15;

  float deviation = abs(avgRatio - 1.0f);
  if (deviation > 0.5f) score -= 30;
  else if (deviation > 0.3f) score -= 20;
  else if (deviation > 0.15f) score -= 10;

  return max(0.0f, min(100.0f, score));
}

// F10 - Fine-grained Edit Boundary Detection

void detectEditBoundaries(const Mat &image, vector<TamperRegion> &regions) {
  Mat gray;
  cvtColor(image, gray, COLOR_BGR2GRAY);

  Mat laplacian;
  Laplacian(gray, laplacian, CV_64F, 3);
  Mat absLap;
  convertScaleAbs(laplacian, absLap);

  int blockSize = 12;
  int rows = gray.rows / blockSize;
  int cols = gray.cols / blockSize;

  if (rows < 4 || cols < 4) return;

  vector<vector<float>> noiseMap(rows, vector<float>(cols, 0));
  for (int r = 0; r < rows; r++) {
    for (int c = 0; c < cols; c++) {
      Rect roi(c * blockSize, r * blockSize, blockSize, blockSize);
      Scalar mean = cv::mean(absLap(roi));
      noiseMap[r][c] = (float)mean[0];
    }
  }

  vector<vector<bool>> suspicious(rows, vector<bool>(cols, false));

  for (int r = 1; r < rows - 1; r++) {
    for (int c = 1; c < cols - 1; c++) {
      float center = noiseMap[r][c];

      float neighborSum = 0;
      float neighborSqSum = 0;
      int nCount = 0;
      for (int dr = -1; dr <= 1; dr++) {
        for (int dc = -1; dc <= 1; dc++) {
          if (dr == 0 && dc == 0) continue;
          float n = noiseMap[r + dr][c + dc];
          neighborSum += n;
          neighborSqSum += n * n;
          nCount++;
        }
      }
      float neighborMean = neighborSum / nCount;
      float neighborVar = neighborSqSum / nCount - neighborMean * neighborMean;
      float neighborStd = sqrt(max(0.0f, neighborVar));

      float diff = abs(center - neighborMean);
      float threshold = max(neighborStd * 1.8f, neighborMean * 0.25f);

      if (diff > threshold && diff > 3.5f) {
        suspicious[r][c] = true;
      }
    }
  }

  vector<vector<bool>> visited(rows, vector<bool>(cols, false));

  for (int r = 1; r < rows - 1; r++) {
    for (int c = 1; c < cols - 1; c++) {
      if (!suspicious[r][c] || visited[r][c]) continue;

      int minR = r, maxR = r, minC = c, maxC = c;
      int clusterSize = 0;
      vector<pair<int, int>> stack;
      stack.push_back({r, c});
      visited[r][c] = true;

      while (!stack.empty()) {
        auto [cr, cc] = stack.back();
        stack.pop_back();
        clusterSize++;
        minR = min(minR, cr);
        maxR = max(maxR, cr);
        minC = min(minC, cc);
        maxC = max(maxC, cc);

        for (int dr = -1; dr <= 1; dr++) {
          for (int dc = -1; dc <= 1; dc++) {
            int nr = cr + dr, nc = cc + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols &&
                suspicious[nr][nc] && !visited[nr][nc]) {
              visited[nr][nc] = true;
              stack.push_back({nr, nc});
            }
          }
        }
      }

      if (clusterSize >= 3) {
        TamperRegion reg;
        reg.x = minC * blockSize;
        reg.y = minR * blockSize;
        reg.w = (maxC - minC + 1) * blockSize;
        reg.h = (maxR - minR + 1) * blockSize;
        reg.type = "edit_boundary";
        reg.confidence = min(100.0f, (float)(clusterSize * 8));
        regions.push_back(reg);
      }
    }
  }
}

// OUTPUT

string escapeJson(const string &s) {
  string result;
  for (char c : s) {
    if (c == '"')
      result += "\\\"";
    else if (c == '\\')
      result += "\\\\";
    else
      result += c;
  }
  return result;
}

void printResult(const EngineResult &r) {
  cout << "{\n";
  cout << "  \"trustScore\": " << r.trustScore << ",\n";
  cout << "  \"status\": \"" << r.status << "\",\n";
  cout << "  \"processingTimeMs\": " << r.processingTimeMs << ",\n";
  cout << "  \"scores\": {\n";
  cout << "    \"splicing\": " << r.splicingScore << ",\n";
  cout << "    \"clone\": " << r.cloneScore << ",\n";
  cout << "    \"uniformOverlay\": " << r.uniformOverlayScore << ",\n";
  cout << "    \"font\": " << r.fontScore << ",\n";
  cout << "    \"nlp\": " << r.nlpScore << ",\n";
  cout << "    \"metadata\": " << r.metadataScore << ",\n";
  cout << "    \"noise\": " << r.noiseScore << ",\n";
  cout << "    \"doubleJpeg\": " << r.doubleJpegScore << ",\n";
  cout << "    \"textNoise\": " << r.textNoiseScore << "\n";
  cout << "  },\n";
  cout << "  \"regions\": [\n";
  set<tuple<int, int, int, int, string>> seen;
  bool firstRegion = true;
  for (size_t i = 0; i < r.regions.size(); i++) {
    const TamperRegion &reg = r.regions[i];
    if (reg.confidence < 0.4f)
      continue;
    if (reg.type == "uniform_overlay" && reg.confidence > 50.0f)
      continue;
    auto key = make_tuple(reg.x, reg.y, reg.w, reg.h, reg.type);
    if (seen.count(key))
      continue;
    seen.insert(key);
    if (!firstRegion)
      cout << ",";
    cout << "\n    {\"x\":" << reg.x << ",\"y\":" << reg.y << ",\"w\":" << reg.w
         << ",\"h\":" << reg.h << ",\"type\":\"" << escapeJson(reg.type) << "\""
         << ",\"confidence\":" << reg.confidence << "}";
    firstRegion = false;
  }
  cout << "\n";

  cout << "  ]\n";
  cout << "}" << endl;
}

// MAIN

int main(int argc, char *argv[]) {

  const char *tessdata = getenv("TESSDATA_PREFIX");
  if (!tessdata) {
    _putenv("TESSDATA_PREFIX=C:/msys64/mingw64/share/tessdata");
  }

  string inputPath;
  if (argc > 1) {
    inputPath = argv[1];
  } else {
    cout << "Enter document path: ";
    cin >> inputPath;
  }

  auto startTime = chrono::high_resolution_clock::now();

  Mat image;
  string ext = inputPath.substr(inputPath.find_last_of('.') + 1);
  transform(ext.begin(), ext.end(), ext.begin(), ::tolower);

  if (ext == "pdf") {
    image = pdfToMat(inputPath);
  } else {
    image = imread(inputPath);
  }

  if (image.empty()) {
    cerr << "{\"error\": \"Could not load file: " << inputPath << "\"}" << endl;
    return -1;
  }

  EngineResult result;

  Mat analysisImage;
  float analysisScale = 1.0f;
  int targetWidth = 600;
  if (image.cols > targetWidth) {
    analysisScale = (float)targetWidth / image.cols;
    resize(image, analysisImage, Size(), analysisScale, analysisScale);
  } else {
    analysisImage = image;
  }

  float sScore, cScore, oScore, mScore, nScore, djScore;
  vector<TamperRegion> splicingRegs, cloneRegs, overlayRegs, noiseRegs, editRegs;
  Mat elaMap;
  OCRData ocrData;

  auto t1 = async(launch::async, [&]() {
    elaMap = computeELA(analysisImage, 95);
    sScore = getSplicingScore(elaMap, splicingRegs);
  });

  auto t2 = async(launch::async,
                  [&]() { cScore = getCloneScore(analysisImage, cloneRegs); });

  auto t3 = async(launch::async, [&]() {
    oScore = getUniformOverlayScore(analysisImage, overlayRegs);
  });

  auto t4 =
      async(launch::async, [&]() { ocrData = performOCR(analysisImage); });

  auto t5 =
      async(launch::async, [&]() { mScore = getMetadataScore(inputPath); });

  auto t6 = async(launch::async,
                  [&]() { nScore = getNoiseScore(analysisImage, noiseRegs); });

  auto t7 = async(launch::async,
                  [&]() { djScore = getDoubleJpegScore(analysisImage); });

  auto t8 = async(launch::async, [&]() {
    detectEditBoundaries(image, editRegs);  
  });

  t1.get();
  t2.get();
  t3.get();
  t4.get();
  t5.get();
  t6.get();
  t7.get();
  t8.get();

  result.splicingScore = sScore;
  result.cloneScore = cScore;
  result.uniformOverlayScore = oScore;
  result.fontScore = getFontConsistencyScore(ocrData.zoneHeights);
  result.nlpScore = getNLPScore(ocrData.text);
  result.metadataScore = mScore;
  result.noiseScore = nScore;
  result.doubleJpegScore = djScore;

  // F9: Text vsbackground noise 
  float tnScore;
  vector<TamperRegion> textNoiseRegs;
  tnScore = getTextNoiseScore(analysisImage, ocrData.wordBoxes, textNoiseRegs);
  result.textNoiseScore = tnScore;

  float invScale = 1.0f / analysisScale;
  auto scaleRegs = [invScale](vector<TamperRegion> &regs) {
    for (auto &r : regs) {
      r.x = (int)(r.x * invScale);
      r.y = (int)(r.y * invScale);
      r.w = (int)(r.w * invScale);
      r.h = (int)(r.h * invScale);
    }
  };
  scaleRegs(splicingRegs);
  scaleRegs(cloneRegs);
  scaleRegs(overlayRegs);
  scaleRegs(noiseRegs);
  scaleRegs(textNoiseRegs);

  vector<TamperRegion> mergedForgedAreas;
  vector<bool> used(textNoiseRegs.size(), false);
  int proxThreshold = 80; 

  for (size_t i = 0; i < textNoiseRegs.size(); i++) {
    if (used[i]) continue;
    used[i] = true;

    int minX = textNoiseRegs[i].x;
    int minY = textNoiseRegs[i].y;
    int maxX = minX + textNoiseRegs[i].w;
    int maxY = minY + textNoiseRegs[i].h;
    float maxConf = textNoiseRegs[i].confidence;
    int groupSize = 1;

    bool changed = true;
    while (changed) {
      changed = false;
      for (size_t j = 0; j < textNoiseRegs.size(); j++) {
        if (used[j]) continue;
        int rx = textNoiseRegs[j].x;
        int ry = textNoiseRegs[j].y;
        int rx2 = rx + textNoiseRegs[j].w;
        int ry2 = ry + textNoiseRegs[j].h;

        bool near = (rx < maxX + proxThreshold && rx2 > minX - proxThreshold &&
                     ry < maxY + proxThreshold && ry2 > minY - proxThreshold);
        if (near) {
          used[j] = true;
          minX = min(minX, rx);
          minY = min(minY, ry);
          maxX = max(maxX, rx2);
          maxY = max(maxY, ry2);
          maxConf = max(maxConf, textNoiseRegs[j].confidence);
          groupSize++;
          changed = true;
        }
      }
    }

    if (groupSize >= 2) {
      int pad = 10;
      TamperRegion merged;
      merged.x = max(0, minX - pad);
      merged.y = max(0, minY - pad);
      merged.w = min(image.cols - merged.x, maxX - minX + 2 * pad);
      merged.h = min(image.rows - merged.y, maxY - minY + 2 * pad);
      merged.type = "forged_area";
      merged.confidence = maxConf;
      mergedForgedAreas.push_back(merged);
    }
  }

  vector<TamperRegion> regions;
  regions.insert(regions.end(), splicingRegs.begin(), splicingRegs.end());
  regions.insert(regions.end(), cloneRegs.begin(), cloneRegs.end());
  regions.insert(regions.end(), overlayRegs.begin(), overlayRegs.end());
  regions.insert(regions.end(), noiseRegs.begin(), noiseRegs.end());
  regions.insert(regions.end(), textNoiseRegs.begin(), textNoiseRegs.end());
  regions.insert(regions.end(), editRegs.begin(), editRegs.end());
  regions.insert(regions.end(), mergedForgedAreas.begin(), mergedForgedAreas.end());

  vector<bool> editUsed(editRegs.size(), false);
  for (size_t i = 0; i < editRegs.size(); i++) {
    if (editUsed[i]) continue;
    editUsed[i] = true;

    int minX = editRegs[i].x, minY = editRegs[i].y;
    int maxX = minX + editRegs[i].w, maxY = minY + editRegs[i].h;
    float maxConf = editRegs[i].confidence;
    int groupSize = 1;

    bool changed = true;
    while (changed) {
      changed = false;
      for (size_t j = 0; j < editRegs.size(); j++) {
        if (editUsed[j]) continue;
        int rx = editRegs[j].x, ry = editRegs[j].y;
        int rx2 = rx + editRegs[j].w, ry2 = ry + editRegs[j].h;

        if (rx < maxX + 60 && rx2 > minX - 60 &&
            ry < maxY + 60 && ry2 > minY - 60) {
          editUsed[j] = true;
          minX = min(minX, rx); minY = min(minY, ry);
          maxX = max(maxX, rx2); maxY = max(maxY, ry2);
          maxConf = max(maxConf, editRegs[j].confidence);
          groupSize++;
          changed = true;
        }
      }
    }

    if (groupSize >= 2) {
      TamperRegion merged;
      merged.x = max(0, minX - 5);
      merged.y = max(0, minY - 5);
      merged.w = min(image.cols - merged.x, maxX - minX + 10);
      merged.h = min(image.rows - merged.y, maxY - minY + 10);
      merged.type = "tampered_area";
      merged.confidence = min(100.0f, maxConf * 1.5f);
      regions.push_back(merged);
    }
  }

  result.regions = regions;

  float weights[] = {0.12f, 0.07f, 0.08f, 0.12f, 0.12f, 0.08f, 0.12f, 0.09f, 0.20f};
  float scores[] = {
      result.splicingScore, result.cloneScore, result.uniformOverlayScore,
      result.fontScore,     result.nlpScore,   result.metadataScore,
      result.noiseScore,    result.doubleJpegScore, result.textNoiseScore};

  float finalScore = 0;
  for (int i = 0; i < 9; i++)
    finalScore += scores[i] * weights[i];

  if (result.splicingScore < 40)
    finalScore *= 0.75f;
  if (result.cloneScore < 40)
    finalScore *= 0.85f;
  if (result.uniformOverlayScore < 40)
    finalScore *= 0.80f;
  if (result.noiseScore < 50)
    finalScore *= 0.80f;
  if (result.nlpScore < 50)
    finalScore *= 0.75f;
  if (result.doubleJpegScore < 50)
    finalScore *= 0.85f;
  if (result.textNoiseScore < 50)
    finalScore *= 0.70f;

  bool hasTamperedArea = false;
  for (const auto &r : regions) {
    if (r.type == "tampered_area") hasTamperedArea = true;
  }
  if (hasTamperedArea)
    finalScore *= 0.55f; 

  result.trustScore = max(0.0f, min(100.0f, finalScore));
  result.status = (result.trustScore >= 70)   ? "SAFE"
                  : (result.trustScore >= 40) ? "SUSPICIOUS"
                                              : "REJECT";

  Mat elaFull;
  resize(elaMap, elaFull, image.size());
  Mat heatmapColor;
  applyColorMap(elaFull, heatmapColor, COLORMAP_JET);
  Mat overlay;
  addWeighted(image, 0.6, heatmapColor, 0.4, 0, overlay);

  for (const TamperRegion &r : regions) {
    Scalar color = (r.type == "splicing")        ? Scalar(0, 0, 255)   // red
                   : (r.type == "uniform_overlay") ? Scalar(0, 165, 255) // orange
                   : (r.type == "noise_anomaly")   ? Scalar(0, 255, 255) // yellow
                   : (r.type == "synthetic_text")   ? Scalar(0, 255, 0)   // green
                   : (r.type == "edit_boundary")    ? Scalar(255, 0, 255) // magenta
                   : (r.type == "forged_area")      ? Scalar(0, 0, 255)   // bright red
                   : (r.type == "tampered_area")    ? Scalar(255, 255, 0) // cyan
                   :                                 Scalar(255, 0, 0);  // blue
    int thickness = (r.type == "tampered_area") ? 5
                    : (r.type == "forged_area") ? 4
                    : (r.type == "edit_boundary") ? 3 : 2;
    rectangle(overlay, Rect(r.x, r.y, r.w, r.h), color, thickness);
  }

  imwrite("heatmap.jpg", elaFull);
  imwrite("overlay.jpg", overlay);

  auto endTime = chrono::high_resolution_clock::now();
  result.processingTimeMs =
      chrono::duration_cast<chrono::milliseconds>(endTime - startTime).count();

  printResult(result);
  return 0;
}
