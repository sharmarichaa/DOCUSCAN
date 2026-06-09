import React from 'react';
import styles from './TrustGauge.module.css';

interface Props {
  score: number; // 0 to 100
}

export const TrustGauge: React.FC<Props> = ({ score }) => {
  const isDanger = score < 50;
  const isWarning = score >= 50 && score < 80;

  // Calculate the stroke dasharray for the SVG circle
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  let colorClass = styles.safe;
  if (isWarning) colorClass = styles.warning;
  if (isDanger) colorClass = styles.danger;

  return (
    <div className={styles.gaugeContainer}>
      <svg className={styles.gauge} width="100" height="100" viewBox="0 0 100 100">
        <circle
          className={styles.gaugeBackground}
          cx="50"
          cy="50"
          r={radius}
        />
        <circle
          className={`${styles.gaugeProgress} ${colorClass}`}
          cx="50"
          cy="50"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
        />
      </svg>
      <div className={styles.gaugeText}>
        <span className={`${styles.score} ${colorClass}`}>{score}</span>
        <span className={styles.label}>/100</span>
      </div>
    </div>
  );
};
