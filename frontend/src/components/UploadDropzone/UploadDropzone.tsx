import React, { useCallback, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import styles from './UploadDropzone.module.css';

interface Props {
  onUpload: (file: File) => void;
}

export const UploadDropzone: React.FC<Props> = ({ onUpload }) => {
  const [isDragging, setIsDragging] = useState(false);

  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onUpload(e.dataTransfer.files[0]);
    }
  }, [onUpload]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onUpload(e.target.files[0]);
    }
  };

  const handleBrowseClick = () => {
    inputRef.current?.click();
  };

  return (
    <div 
      className={`${styles.dropzone} glass-panel ${isDragging ? styles.dragging : ''}`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <input 
        type="file" 
        ref={inputRef}
        className={styles.fileInput} 
        onChange={handleChange}
        onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
        accept=".pdf,.png,.jpg,.jpeg"
      />
      <div className={styles.label}>
        <div className={styles.iconContainer}>
          <UploadCloud size={48} className={styles.icon} />
        </div>
        <h3>Drag & Drop your document here</h3>
        <p>Supports PDF, PNG, JPG (Max 50MB)</p>
        <div className={styles.divider}>
          <span>OR</span>
        </div>
        <button type="button" className="btn-primary" onClick={handleBrowseClick}>
          Browse Files
        </button>
      </div>
      
      <div className={styles.securityNote}>
        <span className="badge safe" style={{fontSize: '0.7rem', marginBottom: '8px', display: 'inline-block'}}>Zero-Knowledge Secure</span>
        <p>Files are processed securely. The ZKP engine ensures data integrity without leaking raw document contents.</p>
      </div>
    </div>
  );
};
