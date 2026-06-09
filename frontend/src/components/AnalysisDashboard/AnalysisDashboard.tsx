import React, { useState } from 'react';
import { ShieldAlert, ShieldCheck, RefreshCw, FileText, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { TrustGauge } from '../TrustGauge/TrustGauge';
import type { AnalysisResponse } from '../../services/api';
import styles from './AnalysisDashboard.module.css';

interface Props {
  file: File;
  result: AnalysisResponse;
  onReset: () => void;
}

export const AnalysisDashboard: React.FC<Props> = ({ file, result, onReset }) => {
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const isSuspicious = result.classification === "SUSPICIOUS" || result.classification === "REJECT";
  
  const totalPages = Math.max(1, result.previewImages.length);
  const currentImage = result.previewImages.length > 0 ? result.previewImages[currentPage] : null;
  const currentHeatmaps = result.heatmapRegions.filter(h => h.pageIndex === currentPage);

  const nextPage = () => setCurrentPage(p => Math.min(totalPages - 1, p + 1));
  const prevPage = () => setCurrentPage(p => Math.max(0, p - 1));

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <div className={styles.fileInfo}>
          <FileText className={styles.fileIcon} />
          <div>
            <h3>{file.name}</h3>
            <p>{(file.size / 1024 / 1024).toFixed(2)} MB • Analysed on {new Date().toLocaleDateString()}</p>
          </div>
        </div>
        <button className="btn-primary" onClick={onReset}>
          <RefreshCw size={16} style={{marginRight: '8px', verticalAlign: 'middle'}}/>
          Analyze Another
        </button>
      </div>

      <div className={styles.grid}>
        {/* Left Column: Document View */}
        <div className={`${styles.documentView} glass-panel`}>
          <div className={styles.panelHeader}>
            <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
              <h4>Document Visualizer</h4>
              {totalPages > 1 && (
                <div className={styles.pagination}>
                  <button onClick={prevPage} disabled={currentPage === 0} className={styles.pageBtn}>
                    <ChevronLeft size={16} />
                  </button>
                  <span>Page {currentPage + 1} of {totalPages}</span>
                  <button onClick={nextPage} disabled={currentPage === totalPages - 1} className={styles.pageBtn}>
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
            <div className={styles.controls}>
              <label className={styles.toggle}>
                <input 
                  type="checkbox" 
                  checked={showHeatmap} 
                  onChange={(e) => setShowHeatmap(e.target.checked)} 
                />
                <span className={styles.slider}></span>
              </label>
              <span>Heatmap Overlay</span>
            </div>
          </div>
          
          <div className={styles.previewContainer}>
             <div className={styles.documentWrapper}>
               {currentImage ? (
                 <img src={currentImage} alt={`Document Page ${currentPage + 1}`} className={styles.documentImage} />
               ) : (
                 <div className={styles.mockPdfPreview}>
                    <p>PDF Preview Mode (Page {currentPage + 1})</p>
                    <small>Backend generated image would appear here.</small>
                 </div>
               )}

               {/* Dynamic Heatmap Overlays for Current Page */}
               {showHeatmap && currentHeatmaps.map((region, index) => (
                 <div 
                   key={index}
                   className={`${styles.heatmapRegion} ${styles[region.severity]}`}
                   style={{
                     left: `${region.x}%`,
                     top: `${region.y}%`,
                     width: `${region.width}%`,
                     height: `${region.height}%`
                   }}
                 ></div>
               ))}
             </div>
          </div>
        </div>

        {/* Right Column: Analysis Results */}
        <div className={styles.resultsColumn}>
          
          <div className={`${styles.scorePanel} glass-panel`}>
            <div className={styles.scoreHeader}>
              <TrustGauge score={result.trustScore} />
              <div className={styles.classification}>
                 {isSuspicious ? (
                   <div className={`${styles.statusBadge} ${styles.danger}`}>
                     <ShieldAlert size={24} />
                     <div>
                       <h5>{result.classification}</h5>
                       <p>High Probability of Tampering</p>
                     </div>
                   </div>
                 ) : (
                   <div className={`${styles.statusBadge} ${styles.safe}`}>
                     <ShieldCheck size={24} />
                     <div>
                       <h5>{result.classification}</h5>
                       <p>Document Intact</p>
                     </div>
                   </div>
                 )}
              </div>
            </div>
            
            <div className={styles.advicePanel}>
              <h4>Actionable Advice</h4>
              <p className={isSuspicious ? styles.textDanger : styles.textSafe}>
                {isSuspicious 
                  ? "Reject document immediately. Request original physical copy for manual review. Flag user ID for potential fraud." 
                  : "Document passes all cryptographic and ML checks. Safe to proceed with underwriting."}
              </p>
            </div>
          </div>

          <div className={`${styles.detailsPanel} glass-panel`}>
            <h4>Forensic Breakdown</h4>
            <ul className={styles.breakdownList}>
              <li>
                <span className={styles.label}>Pixel-Level Splice</span>
                <span className={result.breakdown.pixelSplice.includes("Detected") ? styles.valueWarning : styles.valueSafe}>
                  {result.breakdown.pixelSplice}
                </span>
              </li>
              <li>
                <span className={styles.label}>Font Consistency</span>
                <span className={result.breakdown.fontConsistency.includes("Failed") ? styles.valueWarning : styles.valueSafe}>
                  {result.breakdown.fontConsistency}
                </span>
              </li>
              <li>
                <span className={styles.label}>NLP Cross-Validation</span>
                <span className={result.breakdown.nlpValidation.includes("Failed") ? styles.valueWarning : styles.valueSafe}>
                  {result.breakdown.nlpValidation}
                </span>
              </li>
              <li>
                <span className={styles.label}>ZKP Integrity</span>
                <span className={result.breakdown.zkpIntegrity.includes("Mismatch") ? styles.valueWarning : styles.valueSafe}>
                  {result.breakdown.zkpIntegrity}
                </span>
              </li>
            </ul>
          </div>

          <div className={`${styles.auditPanel} glass-panel`}>
            <div className={styles.panelHeader}>
              <h4>RBI Audit Log</h4>
              <button className={styles.iconBtn} title="Download Report">
                <Download size={18} />
              </button>
            </div>
            <table className={styles.auditTable}>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Metadata Scan</td>
                  <td className={isSuspicious ? styles.textDanger : styles.textSafe}>
                    {isSuspicious ? 'Re-saved' : 'Clear'}
                  </td>
                </tr>
                <tr>
                  <td>Clone Stamping</td>
                  <td className={styles.textSafe}>Clear</td>
                </tr>
                <tr>
                  <td>ZKP Verify</td>
                  <td className={isSuspicious ? styles.textDanger : styles.textSafe}>
                    {isSuspicious ? 'Failed' : 'Verified'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </div>
  );
};
