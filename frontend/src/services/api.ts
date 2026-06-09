export interface AnalysisResponse {
  trustScore: number;
  classification: "SAFE" | "SUSPICIOUS" | "REJECT";
  heatmapRegions: Array<{
    pageIndex: number;
    x: number; // percentage (0-100)
    y: number; // percentage (0-100)
    width: number; // percentage (0-100)
    height: number; // percentage (0-100)
    severity: "low" | "medium" | "high";
  }>;
  breakdown: {
    pixelSplice: string;
    fontConsistency: string;
    nlpValidation: string;
    zkpIntegrity: string;
  };
  previewImages: string[]; // Array of local URLs or base64 strings for each page
}

export const analyzeDocument = async (file: File): Promise<AnalysisResponse> => {
  // Simulate backend processing time
  await new Promise(resolve => setTimeout(resolve, 2500));

  const isSuspicious = file.name.toLowerCase().includes('fake') || file.size > 1024 * 500; // Mock logic

  // Mocking 2 pages if it's suspicious, else 1 page
  const pageCount = isSuspicious ? 2 : 1;
  const previewImages = [];
  if (file.type.startsWith('image/')) {
    previewImages.push(URL.createObjectURL(file));
    if (pageCount > 1) previewImages.push(URL.createObjectURL(file)); // Mock 2nd page with same image
  }

  return {
    trustScore: isSuspicious ? 32 : 94,
    classification: isSuspicious ? "SUSPICIOUS" : "SAFE",
    heatmapRegions: isSuspicious ? [
      { pageIndex: 0, x: 55, y: 70, width: 30, height: 12, severity: "high" }, // Signature
      { pageIndex: 1, x: 15, y: 20, width: 25, height: 5, severity: "medium" } // Date on page 2
    ] : [],
    breakdown: {
      pixelSplice: isSuspicious ? "Detected (Signature Area)" : "Clear",
      fontConsistency: isSuspicious ? "Failed (Date Field)" : "Passed",
      nlpValidation: "Passed",
      zkpIntegrity: isSuspicious ? "Mismatch from origin" : "Verified"
    },
    previewImages
  };
};
