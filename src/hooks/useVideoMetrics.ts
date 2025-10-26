import { useEffect, useState, useRef } from 'react';

interface VideoMetrics {
  resolution: string;
  actualBitrate: number; // Mbps - calculé depuis les bytes téléchargés
  fps: number;
  droppedFrames: number;
  totalFrames: number;
  bufferLevel: number; // secondes
  latency: number; // ms
}

export const useVideoMetrics = (videoElement: HTMLVideoElement | null) => {
  const [metrics, setMetrics] = useState<VideoMetrics>({
    resolution: 'N/A',
    actualBitrate: 0,
    fps: 0,
    droppedFrames: 0,
    totalFrames: 0,
    bufferLevel: 0,
    latency: 0,
  });

  const lastFramesRef = useRef(0);
  const lastTimeRef = useRef(Date.now());
  const bytesHistoryRef = useRef<Array<{bytes: number, time: number}>>([]);

  useEffect(() => {
    if (!videoElement) return;

    const measureInterval = setInterval(() => {
      // Résolution
      const resolution = `${videoElement.videoWidth}x${videoElement.videoHeight}`;
      const qualityLabel = 
        videoElement.videoHeight >= 1080 ? 'FHD 1080p' :
        videoElement.videoHeight >= 720 ? 'HD 720p' :
        videoElement.videoHeight >= 480 ? 'SD 480p' : 
        videoElement.videoHeight > 0 ? `${videoElement.videoHeight}p` : 'N/A';

      // Buffer level
      let bufferLevel = 0;
      if (videoElement.buffered.length > 0) {
        bufferLevel = videoElement.buffered.end(0) - videoElement.currentTime;
      }

      // Latency = combien on est en retard sur le live edge
      // Pour un live stream, on veut être proche de la fin du buffer
      const latency = Math.round(bufferLevel * 1000);

      // Video Quality API (Chrome/Edge)
      // @ts-ignore
      const quality = videoElement.getVideoPlaybackQuality?.();
      const droppedFrames = quality?.droppedVideoFrames || 0;
      const totalFrames = quality?.totalVideoFrames || 0;
      
      // FPS réel (delta frames / delta time)
      const now = Date.now();
      const timeDelta = (now - lastTimeRef.current) / 1000; // secondes
      const framesDelta = totalFrames - lastFramesRef.current;
      const fps = timeDelta > 0 ? Math.round(framesDelta / timeDelta) : 0;
      
      lastFramesRef.current = totalFrames;
      lastTimeRef.current = now;

      // Bitrate réel - mesurer les bytes téléchargés via Performance API
      let actualBitrate = 0;
      if (performance && (performance as any).getEntriesByType) {
        try {
          const resources = (performance as any).getEntriesByType('resource');
          const videoResources = resources.filter((r: any) => {
            // Détecter les ressources vidéo, incluant les proxies Supabase
            const name = r.name.toLowerCase();
            return name.includes('stream-proxy') ||  // Proxy Supabase
                   name.includes('stream') || 
                   name.includes('video') || 
                   name.includes('segment') ||
                   name.includes('supabase.co/functions') || // Edge functions
                   name.includes('.ts') ||
                   name.includes('.m4s') ||
                   name.includes('.mp4') ||
                   (r.initiatorType === 'xmlhttprequest' && r.transferSize > 100000); // XHR volumineux
          });
          
          if (videoResources.length > 0) {
            const totalBytes = videoResources.reduce((sum: number, r: any) => 
              sum + (r.transferSize || r.encodedBodySize || 0), 0
            );
            
            // Garder historique des 5 dernières secondes
            bytesHistoryRef.current.push({ bytes: totalBytes, time: now });
            bytesHistoryRef.current = bytesHistoryRef.current.filter(
              entry => now - entry.time < 5000
            );
            
            // Calculer bitrate sur les 5 dernières secondes
            if (bytesHistoryRef.current.length >= 2) {
              const oldest = bytesHistoryRef.current[0];
              const newest = bytesHistoryRef.current[bytesHistoryRef.current.length - 1];
              const bytesDiff = newest.bytes - oldest.bytes;
              const timeDiff = (newest.time - oldest.time) / 1000; // secondes
              
              if (timeDiff > 0 && bytesDiff > 0) {
                actualBitrate = (bytesDiff * 8) / (timeDiff * 1000000); // Mbps
              }
            }
          }
        } catch (e) {
          console.warn('Performance API error:', e);
        }
      }

      setMetrics({
        resolution: qualityLabel,
        actualBitrate: Math.max(0, actualBitrate),
        fps: Math.max(0, Math.min(fps, 60)), // Cap entre 0 et 60 fps
        droppedFrames,
        totalFrames,
        bufferLevel,
        latency,
      });
    }, 1000);

    return () => clearInterval(measureInterval);
  }, [videoElement]);

  return metrics;
};
