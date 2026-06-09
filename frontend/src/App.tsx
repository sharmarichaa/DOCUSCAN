import { useState } from 'react';
import { UploadDropzone } from './components/UploadDropzone/UploadDropzone';
import { AnalysisDashboard } from './components/AnalysisDashboard/AnalysisDashboard';
import { Activity } from 'lucide-react';
import { analyzeDocument, type AnalysisResponse } from './services/api';
import './App.css';

function App() {
  const [appState, setAppState] = useState<'idle' | 'analyzing' | 'complete'>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(null);

  const handleFileUpload = async (file: File) => {
    setSelectedFile(file);
    setAppState('analyzing');
    
    try {
      const result = await analyzeDocument(file);
      setAnalysisResult(result);
      setAppState('complete');
    } catch (error) {
      console.error("Analysis failed:", error);
      setAppState('idle');
    }
  };

  const handleReset = () => {
    setAppState('idle');
    setSelectedFile(null);
    setAnalysisResult(null);
  };

  return (
    <div className="app-container">
      <nav className="navbar glass-panel">
        <div className="logo-section">
          <Activity className="logo-icon" size={28} />
          <h2>DOCUSCAN <span className="subtitle">Underwriter Portal</span></h2>
        </div>
        <div className="user-section">
          <span className="badge safe">System Secure</span>
        </div>
      </nav>

      <main className="main-content">
        {appState === 'idle' && (
          <div className="upload-view">
            <h1 className="page-title">Document Forensics Analysis</h1>
            <p className="page-desc">Upload a document to run pixel-level tamper detection, font consistency checks, and NLP cross-validation.</p>
            <UploadDropzone onUpload={handleFileUpload} />
          </div>
        )}

        {appState === 'analyzing' && (
          <div className="analyzing-view flex-center">
            <div className="loader glass-panel">
              <Activity className="spinner-icon" size={48} />
              <h3>Analyzing Document...</h3>
              <p>Running ML models and cryptographic checks...</p>
            </div>
          </div>
        )}

        {appState === 'complete' && selectedFile && analysisResult && (
          <AnalysisDashboard 
            file={selectedFile} 
            result={analysisResult} 
            onReset={handleReset} 
          />
        )}
      </main>
    </div>
  );
}

export default App;
