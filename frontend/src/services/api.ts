const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

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
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Analysis failed (HTTP ${response.status})`);
    }

    const result = await response.json();

    // If backend didn't return preview images, generate from the uploaded file
    const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/i.test(file.name);
    
    if ((!result.previewImages || result.previewImages.length === 0) && isImage) {
      result.previewImages = [URL.createObjectURL(file)];
    }

    return result;
  } catch (error) {
    // If backend is unreachable, throw a descriptive error
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error("Backend server is not running. Please start the backend with: cd backend && npm run dev");
    }
    throw error;
  }
};
