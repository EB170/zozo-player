export interface StreamQuality {
  id: string;
  label: string;
  bandwidth: number; // bits per second
  resolution?: string;
  codecs?: string;
  url?: string;
}

/**
 * Parse un manifest HLS (.m3u8) pour extraire les qualités disponibles
 */
export const parseHLSManifest = async (url: string): Promise<StreamQuality[]> => {
  try {
    const response = await fetch(url);
    const text = await response.text();
    const qualities: StreamQuality[] = [];
    
    const lines = text.split('\n');
    let currentBandwidth = 0;
    let currentResolution = '';
    let currentCodecs = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Parser les attributs de #EXT-X-STREAM-INF
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        // Extraire BANDWIDTH
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        if (bandwidthMatch) {
          currentBandwidth = parseInt(bandwidthMatch[1]);
        }
        
        // Extraire RESOLUTION
        const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
        if (resolutionMatch) {
          currentResolution = resolutionMatch[1];
        }
        
        // Extraire CODECS
        const codecsMatch = line.match(/CODECS="([^"]+)"/);
        if (codecsMatch) {
          currentCodecs = codecsMatch[1];
        }
        
        // La ligne suivante contient l'URL du stream
        if (i + 1 < lines.length) {
          const streamUrl = lines[i + 1].trim();
          
          if (streamUrl && !streamUrl.startsWith('#')) {
            const height = currentResolution ? parseInt(currentResolution.split('x')[1]) : 0;
            const label = 
              height >= 1080 ? 'FHD 1080p' :
              height >= 720 ? 'HD 720p' :
              height >= 480 ? 'SD 480p' :
              height >= 360 ? 'SD 360p' :
              `${(currentBandwidth / 1000000).toFixed(1)} Mbps`;
            
            qualities.push({
              id: `quality_${currentBandwidth}`,
              label,
              bandwidth: currentBandwidth,
              resolution: currentResolution,
              codecs: currentCodecs,
              url: streamUrl.startsWith('http') ? streamUrl : new URL(streamUrl, url).href,
            });
          }
        }
      }
    }
    
    // Trier par bandwidth (du plus haut au plus bas)
    qualities.sort((a, b) => b.bandwidth - a.bandwidth);
    
    console.log(`📺 Found ${qualities.length} HLS qualities:`, qualities);
    return qualities;
  } catch (error) {
    console.error('Error parsing HLS manifest:', error);
    return [];
  }
};

/**
 * Pour MPEG-TS, on ne peut pas parser un manifest (c'est un stream direct)
 * Mais on peut détecter la qualité actuelle via les métriques vidéo
 */
export const detectMPEGTSQuality = (
  videoWidth: number,
  videoHeight: number,
  bitrate: number
): StreamQuality => {
  const resolution = `${videoWidth}x${videoHeight}`;
  const label = 
    videoHeight >= 1080 ? 'FHD 1080p' :
    videoHeight >= 720 ? 'HD 720p' :
    videoHeight >= 480 ? 'SD 480p' :
    videoHeight >= 360 ? 'SD 360p' :
    'Auto';
  
  return {
    id: 'mpegts_current',
    label,
    bandwidth: bitrate * 1000000, // Mbps to bps
    resolution,
  };
};

/**
 * Recommander une qualité basée sur le bandwidth disponible
 */
export const recommendQuality = (
  availableBandwidth: number, // Mbps
  qualities: StreamQuality[]
): StreamQuality | null => {
  if (qualities.length === 0) return null;
  
  // Garder une marge de sécurité (80% du bandwidth)
  const safeBandwidth = availableBandwidth * 0.8 * 1000000; // Convert to bps
  
  // Trouver la qualité la plus haute qui rentre dans le budget
  const suitable = qualities.find(q => q.bandwidth <= safeBandwidth);
  
  // Si aucune ne convient, prendre la plus basse
  return suitable || qualities[qualities.length - 1];
};

/**
 * Estimer la latence live basée sur le buffer
 */
export const estimateLiveLatency = (
  bufferLevel: number, // secondes
  targetLatency: number = 3 // secondes cibles
): { latency: number; health: 'good' | 'warning' | 'critical' } => {
  const latency = bufferLevel;
  
  let health: 'good' | 'warning' | 'critical' = 'good';
  if (latency < 1) health = 'critical';
  else if (latency < 2) health = 'warning';
  
  return { latency, health };
};
