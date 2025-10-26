import { useEffect, useState } from 'react';

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

  useEffect(() => {
    if (!videoElement) return;

    let lastBytesDownloaded = 0;
    let lastTime = Date.now();

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

      // Latency estimée (basée sur buffer)
      const latency = Math.round(bufferLevel * 1000);

      // Video Quality API (Chrome/Edge)
      // @ts-ignore
      const quality = videoElement.getVideoPlaybackQuality?.();
      const droppedFrames = quality?.droppedVideoFrames || 0;
      const totalFrames = quality?.totalVideoFrames || 0;
      
      // FPS estimation
      const fps = totalFrames > 0 ? Math.round(totalFrames / videoElement.currentTime) : 0;

      // Bitrate réel - utiliser Performance API si disponible
      let actualBitrate = 0;
      if (performance && (performance as any).getEntriesByType) {
        const resources = (performance as any).getEntriesByType('resource');
        const videoResources = resources.filter((r: any) => 
          r.name.includes('.ts') || r.name.includes('.m3u8') || r.name.includes('stream')
        );
        
        if (videoResources.length > 0) {
          const now = Date.now();
          const timeDiff = (now - lastTime) / 1000; // secondes
          
          const totalBytes = videoResources.reduce((sum: number, r: any) => 
            sum + (r.transferSize || 0), 0
          );
          
          if (totalBytes > lastBytesDownloaded && timeDiff > 0) {
            const bytesDiff = totalBytes - lastBytesDownloaded;
            actualBitrate = (bytesDiff * 8) / (timeDiff * 1000000); // Mbps
            lastBytesDownloaded = totalBytes;
            lastTime = now;
          }
        }
      }

      setMetrics({
        resolution: qualityLabel,
        actualBitrate: Math.max(0, actualBitrate),
        fps: Math.min(fps, 60), // Cap à 60 fps
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
