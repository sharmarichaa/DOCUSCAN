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
#include <vector>
#include <tuple>

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

  for (const auto &zone : zoneHeights) {
    const vector<float> &heights = zone.second;
    if (heights.size() < 3)
      continue;

    float mean =
        accumulate(heights.begin(), heights.end(), 0.0f) / heights.size();
    float variance = 0;
    for (float h : heights)
      variance += (h - mean) * (h - mean);
    variance /= heights.size();
    float stddev = sqrt(variance);

    float cv = stddev / (mean + 0.01f);
    if (cv > 0.5f)
      score -= 25;
    else if (cv > 0.3f)
      score -= 10;
  }

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
  cout << "    \"metadata\": " << r.metadataScore << "\n";
  cout << "  },\n";
  cout << "  \"regions\": [\n";
  set<tuple<int,int,int,int,string>> seen;
  bool firstRegion = true;
  for (size_t i = 0; i < r.regions.size(); i++) {
    const TamperRegion &reg = r.regions[i];
    if (reg.confidence < 0.4f) continue;
    if (reg.type == "uniform_overlay" && reg.confidence > 50.0f) continue;
    auto key = make_tuple(reg.x, reg.y, reg.w, reg.h, reg.type);
    if (seen.count(key)) continue;
    seen.insert(key);
    if (!firstRegion) cout << ",";
    cout << "\n    {\"x\":" << reg.x << ",\"y\":" << reg.y
         << ",\"w\":" << reg.w << ",\"h\":" << reg.h
         << ",\"type\":\"" << escapeJson(reg.type) << "\""
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

  float sScore, cScore, oScore, mScore;
  vector<TamperRegion> splicingRegs, cloneRegs, overlayRegs;
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

  t1.get();
  t2.get();
  t3.get();
  t4.get();
  t5.get();

  result.splicingScore = sScore;
  result.cloneScore = cScore;
  result.uniformOverlayScore = oScore;
  result.fontScore = getFontConsistencyScore(ocrData.zoneHeights);
  result.nlpScore = getNLPScore(ocrData.text);
  result.metadataScore = mScore;


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

  vector<TamperRegion> regions;
  regions.insert(regions.end(), splicingRegs.begin(), splicingRegs.end());
  regions.insert(regions.end(), cloneRegs.begin(), cloneRegs.end());
  regions.insert(regions.end(), overlayRegs.begin(), overlayRegs.end());
  result.regions = regions;

  float weights[] = {0.25f, 0.10f, 0.15f, 0.20f, 0.15f, 0.15f};
  float scores[] = {
      result.splicingScore, result.cloneScore, result.uniformOverlayScore,
      result.fontScore,     result.nlpScore,   result.metadataScore};

  float finalScore = 0;
  for (int i = 0; i < 6; i++)
    finalScore += scores[i] * weights[i];

  if (result.splicingScore < 40)
    finalScore *= 0.75f;
  if (result.cloneScore < 40)
    finalScore *= 0.85f;
  if (result.uniformOverlayScore < 40)
    finalScore *= 0.80f;

  result.trustScore = max(0.0f, min(100.0f, finalScore));
  result.status = (result.trustScore >= 75)   ? "SAFE"
                  : (result.trustScore >= 50) ? "SUSPICIOUS"
                                              : "REJECT";


  Mat elaFull;
  resize(elaMap, elaFull, image.size());
  Mat heatmapColor;
  applyColorMap(elaFull, heatmapColor, COLORMAP_JET);
  Mat overlay;
  addWeighted(image, 0.6, heatmapColor, 0.4, 0, overlay);

  for (const TamperRegion &r : regions) {
    Scalar color = (r.type == "splicing") ? Scalar(0, 0, 255) // red
                   : (r.type == "uniform_overlay")
                       ? Scalar(0, 165, 255) // orange
                       : Scalar(255, 0, 0);  // blue
    rectangle(overlay, Rect(r.x, r.y, r.w, r.h), color, 2);
  }

  imwrite("heatmap.jpg", elaFull);
  imwrite("overlay.jpg", overlay);

  auto endTime = chrono::high_resolution_clock::now();
  result.processingTimeMs =
      chrono::duration_cast<chrono::milliseconds>(endTime - startTime).count();

  printResult(result);
  return 0;
}
