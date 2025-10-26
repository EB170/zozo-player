import { useEffect, useRef, useState } from 'react';

interface BandwidthMetrics {
  currentBandwidth: number; // Mbps
  averageBandwidth: number; // Mbps
  trend: 'stable' | 'increasing' | 'decreasing';
  recommendedQuality: 'low' | 'medium' | 'high' | 'auto';
}

export const useBandwidthMonitor = () => {
  const [metrics, setMetrics] = useState<BandwidthMetrics>({
    currentBandwidth: 0,
    averageBandwidth: 0,
    trend: 'stable',
    recommendedQuality: 'auto',
  });

  const samplesRef = useRef<number[]>([]);
  const lastBytesRef = useRef(0);
  const lastTimeRef = useRef(Date.now());

  useEffect(() => {
    // Mesurer bandwidth toutes les 5 secondes
    const interval = setInterval(() => {
      // Utiliser Performance API si disponible
      if ('connection' in navigator) {
        const connection = (navigator as any).connection;
        if (connection && connection.downlink) {
          const bandwidth = connection.downlink; // Mbps
          
          // Garder historique des 12 dernières mesures (1 minute)
          samplesRef.current.push(bandwidth);
          if (samplesRef.current.length > 12) {
            samplesRef.current.shift();
          }

          // Calculer moyenne
          const average = samplesRef.current.reduce((a, b) => a + b, 0) / samplesRef.current.length;
          
          // Déterminer tendance
          let trend: 'stable' | 'increasing' | 'decreasing' = 'stable';
          if (samplesRef.current.length >= 3) {
            const recent = samplesRef.current.slice(-3);
            const older = samplesRef.current.slice(-6, -3);
            const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
            const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg;
            
            if (recentAvg > olderAvg * 1.2) trend = 'increasing';
            else if (recentAvg < olderAvg * 0.8) trend = 'decreasing';
          }

          // Recommander qualité selon bandwidth
          let recommendedQuality: 'low' | 'medium' | 'high' | 'auto' = 'auto';
          if (average < 2) recommendedQuality = 'low';
          else if (average < 5) recommendedQuality = 'medium';
          else recommendedQuality = 'high';

          setMetrics({
            currentBandwidth: bandwidth,
            averageBandwidth: average,
            trend,
            recommendedQuality,
          });

          console.log(`📊 Bandwidth: ${bandwidth.toFixed(2)} Mbps (avg: ${average.toFixed(2)}, trend: ${trend})`);
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return metrics;
};
