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

  useEffect(() => {
    // Mesurer bandwidth toutes les 5 secondes via Network Information API
    const interval = setInterval(() => {
      // Utiliser Network Information API si disponible
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
          if (samplesRef.current.length >= 6) {
            const recent = samplesRef.current.slice(-3);
            const older = samplesRef.current.slice(-6, -3);
            const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
            const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
            
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
        } else {
          // Fallback: utiliser effectiveType
          const effectiveType = connection?.effectiveType || '4g';
          const estimatedBandwidth = 
            effectiveType === '5g' ? 20 :
            effectiveType === '4g' ? 10 :
            effectiveType === '3g' ? 2 : 1;
          
          setMetrics({
            currentBandwidth: estimatedBandwidth,
            averageBandwidth: estimatedBandwidth,
            trend: 'stable',
            recommendedQuality: estimatedBandwidth > 5 ? 'high' : estimatedBandwidth > 2 ? 'medium' : 'low',
          });
        }
      } else {
        // Pas de Network API - valeurs par défaut conservatrices
        setMetrics({
          currentBandwidth: 5,
          averageBandwidth: 5,
          trend: 'stable',
          recommendedQuality: 'auto',
        });
      }
    }, 5000);

    // Mesure initiale immédiate
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      const initialBandwidth = connection?.downlink || 5;
      samplesRef.current.push(initialBandwidth);
      setMetrics({
        currentBandwidth: initialBandwidth,
        averageBandwidth: initialBandwidth,
        trend: 'stable',
        recommendedQuality: initialBandwidth > 5 ? 'high' : initialBandwidth > 2 ? 'medium' : 'low',
      });
    }

    return () => clearInterval(interval);
  }, []);

  return metrics;
};
