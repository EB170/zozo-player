import { useEffect, useRef, useState } from 'react';

interface BandwidthData {
  currentBitrate: number; // Mbps - basé sur transferts réels
  averageBitrate: number; // Mbps - moyenne sur 30s
  downloadSpeed: number; // Mbps - vitesse instantanée
  trend: 'stable' | 'increasing' | 'decreasing';
}

export const useRealBandwidth = () => {
  const [bandwidth, setBandwidth] = useState<BandwidthData>({
    currentBitrate: 0,
    averageBitrate: 0,
    downloadSpeed: 0,
    trend: 'stable',
  });

  const samplesRef = useRef<Array<{bytes: number, time: number}>>([]);
  const observerRef = useRef<PerformanceObserver | null>(null);

  useEffect(() => {
    // Utiliser PerformanceObserver pour capturer les transferts en temps réel
    try {
      observerRef.current = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const now = Date.now();
        
        for (const entry of entries) {
          const resource = entry as PerformanceResourceTiming;
          
          // Filtrage amélioré - capture plus large de ressources vidéo
          const url = resource.name.toLowerCase();
          const isVideoResource = 
            url.includes('stream') ||
            url.includes('video') ||
            url.includes('segment') ||
            url.includes('chunk') ||
            url.includes('media') ||
            url.includes('.ts') ||
            url.includes('.m4s') ||
            url.includes('.mp4') ||
            url.includes('.m3u8') ||
            url.includes('.mpd') ||
            // Détection par content-type si disponible
            (resource.transferSize > 10000); // Plus de 10KB = probablement vidéo
          
          if (isVideoResource) {
            const bytes = resource.transferSize || resource.encodedBodySize || 0;
            
            if (bytes > 0) {
              samplesRef.current.push({ bytes, time: now });
              
              // Garder seulement les 30 dernières secondes
              samplesRef.current = samplesRef.current.filter(
                sample => now - sample.time < 30000
              );
            }
          }
        }
      });

      observerRef.current.observe({ 
        entryTypes: ['resource'],
        buffered: true 
      });
    } catch (e) {
      console.warn('PerformanceObserver not available:', e);
    }

    // Calculer metrics toutes les 2 secondes
    const interval = setInterval(() => {
      if (samplesRef.current.length < 2) {
        return;
      }

      const now = Date.now();
      const samples = samplesRef.current;
      
      // Bitrate instantané (dernières 2 secondes)
      const recentSamples = samples.filter(s => now - s.time < 2000);
      let currentBitrate = 0;
      
      if (recentSamples.length >= 2) {
        const totalBytes = recentSamples.reduce((sum, s) => sum + s.bytes, 0);
        const timeSpan = (now - recentSamples[0].time) / 1000;
        currentBitrate = timeSpan > 0 ? (totalBytes * 8) / (timeSpan * 1000000) : 0;
      }

      // Bitrate moyen (toute la fenêtre de 30s)
      let averageBitrate = 0;
      if (samples.length >= 2) {
        const totalBytes = samples.reduce((sum, s) => sum + s.bytes, 0);
        const timeSpan = (samples[samples.length - 1].time - samples[0].time) / 1000;
        averageBitrate = timeSpan > 0 ? (totalBytes * 8) / (timeSpan * 1000000) : 0;
      }

      // Download speed (vitesse de transfert instantanée)
      const downloadSpeed = currentBitrate;

      // Tendance (comparaison récent vs ancien)
      let trend: 'stable' | 'increasing' | 'decreasing' = 'stable';
      if (samples.length >= 10) {
        const mid = Math.floor(samples.length / 2);
        const oldSamples = samples.slice(0, mid);
        const newSamples = samples.slice(mid);
        
        const oldBytes = oldSamples.reduce((sum, s) => sum + s.bytes, 0);
        const newBytes = newSamples.reduce((sum, s) => sum + s.bytes, 0);
        const oldTime = (oldSamples[oldSamples.length - 1].time - oldSamples[0].time) / 1000;
        const newTime = (newSamples[newSamples.length - 1].time - newSamples[0].time) / 1000;
        
        const oldRate = oldTime > 0 ? (oldBytes * 8) / (oldTime * 1000000) : 0;
        const newRate = newTime > 0 ? (newBytes * 8) / (newTime * 1000000) : 0;
        
        if (newRate > oldRate * 1.3) trend = 'increasing';
        else if (newRate < oldRate * 0.7) trend = 'decreasing';
      }

      setBandwidth({
        currentBitrate: Math.max(0, currentBitrate),
        averageBitrate: Math.max(0, averageBitrate),
        downloadSpeed: Math.max(0, downloadSpeed),
        trend,
      });

      if (currentBitrate > 0) {
        if (import.meta.env.DEV) {
          console.log(`📊 Real Bandwidth: ${currentBitrate.toFixed(2)} Mbps (avg: ${averageBitrate.toFixed(2)}, trend: ${trend})`);
        }
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  return bandwidth;
};
