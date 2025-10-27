import { useEffect, useRef, useState, useCallback } from "react";
import mpegts from "mpegts.js";
import Hls from "hls.js";
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2, PictureInPicture, BarChart3, Settings as SettingsIcon } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { PlayerStats } from "./PlayerStats";
import { PlayerSettings } from "./PlayerSettings";
import { QualityIndicator } from "./QualityIndicator";
import { useRealBandwidth } from "@/hooks/useRealBandwidth";
import { useVideoMetrics } from "@/hooks/useVideoMetrics";
import { useHealthMonitor } from "@/hooks/useHealthMonitor";
import { parseHLSManifest, StreamQuality } from "@/utils/manifestParser";
import { toast } from "sonner";
interface VideoPlayerProps {
  streamUrl: string;
  autoPlay?: boolean;
}
type PlayerType = 'mpegts' | 'hls';
const getProxiedUrl = (originalUrl: string): string => {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || "wxkvljkvqcamktlwfmfx";
  const proxyUrl = `https://${projectId}.supabase.co/functions/v1/stream-proxy`;
  return `${proxyUrl}?url=${encodeURIComponent(originalUrl)}`;
};

// Détection intelligente du format
const detectStreamType = (url: string): PlayerType => {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('.m3u8') || urlLower.includes('m3u8')) {
    return 'hls';
  }
  if (urlLower.includes('.ts') || urlLower.includes('extension=ts')) {
    return 'mpegts';
  }
  // Par défaut MPEG-TS pour les flux IPTV
  return 'mpegts';
};

// Détection réseau
const getNetworkSpeed = (): 'fast' | 'medium' | 'slow' => {
  const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  if (connection) {
    const effectiveType = connection.effectiveType;
    if (effectiveType === '4g' || effectiveType === '5g') return 'fast';
    if (effectiveType === '3g') return 'medium';
    return 'slow';
  }
  return 'fast';
};
export const VideoPlayerHybrid = ({
  streamUrl,
  autoPlay = true
}: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mpegtsRef = useRef<any>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTapTimeRef = useRef(0);
  const lastTapSideRef = useRef<'left' | 'right' | null>(null);
  const playerTypeRef = useRef<PlayerType>('mpegts');
  const useProxyRef = useRef(false);
  const fragErrorCountRef = useRef(0);
  const isTransitioningRef = useRef(false);
  const hlsDebugMode = useRef(false); // Toggle pour debug HLS
  const memoryCleanupIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const uptimeStartRef = useRef<number>(Date.now());
  const lastMemoryCleanupRef = useRef<number>(Date.now());
  const playbackQualityCheckRef = useRef<number>(0);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [bufferHealth, setBufferHealth] = useState(100);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [quality, setQuality] = useState('auto');
  const [showSeekFeedback, setShowSeekFeedback] = useState<{
    direction: 'forward' | 'backward';
    show: boolean;
  }>({
    direction: 'forward',
    show: false
  });
  const [availableQualities, setAvailableQualities] = useState<StreamQuality[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();
  const videoMetrics = useVideoMetrics(videoRef.current);
  const realBandwidth = useRealBandwidth();
  const {
    health: healthStatus
  } = useHealthMonitor(videoRef.current);
  const networkSpeed = getNetworkSpeed();

  // Cleanup complet
  const cleanup = useCallback(() => {
    const video = videoRef.current;
    
    // Pause et reset vidéo pour éviter overlaps
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
    if (memoryCleanupIntervalRef.current) {
      clearInterval(memoryCleanupIntervalRef.current);
      memoryCleanupIntervalRef.current = null;
    }
    
    if (mpegtsRef.current) {
      // Nettoyer watchdog et maintenance si existants
      const watchdog = (mpegtsRef.current as any)._watchdogInterval;
      if (watchdog) {
        clearInterval(watchdog);
        (mpegtsRef.current as any)._watchdogInterval = null;
      }
      const maintenance = (mpegtsRef.current as any)._maintenanceInterval;
      if (maintenance) {
        clearInterval(maintenance);
        (mpegtsRef.current as any)._maintenanceInterval = null;
      }
      
      try {
        mpegtsRef.current.pause();
        mpegtsRef.current.unload();
        mpegtsRef.current.detachMediaElement();
        mpegtsRef.current.destroy();
      } catch (e) {
        console.warn('MPEGTS cleanup error:', e);
      }
      mpegtsRef.current = null;
    }
    
    if (hlsRef.current) {
      // Nettoyer maintenance interval
      const maintenance = (hlsRef.current as any)._maintenanceInterval;
      if (maintenance) {
        clearInterval(maintenance);
        (hlsRef.current as any)._maintenanceInterval = null;
      }
      
      try {
        hlsRef.current.stopLoad();
        hlsRef.current.detachMedia();
        hlsRef.current.destroy();
      } catch (e) {
        console.warn('HLS cleanup error:', e);
      }
      hlsRef.current = null;
    }
  }, []);

  // Configuration MPEGTS optimale
  const getOptimalBufferSize = useCallback(() => {
    const bandwidth = realBandwidth.averageBitrate || 10;
    let baseSize = 1024;
    if (bandwidth > 10) baseSize = 1536;else if (bandwidth > 6) baseSize = 1024;else if (bandwidth > 3) baseSize = 768;else baseSize = 512;
    if (networkSpeed === 'slow') baseSize = Math.round(baseSize * 0.7);else if (networkSpeed === 'fast') baseSize = Math.round(baseSize * 1.3);
    return baseSize;
  }, [realBandwidth.averageBitrate, networkSpeed]);

  // Retry avec backoff exponentiel
  const scheduleRetry = useCallback((retryFn: () => void) => {
    if (retryCountRef.current >= 5) {
      console.error('❌ Max retries reached');
      setErrorMessage("Impossible de charger le flux après plusieurs tentatives");
      toast.error("Échec de chargement", {
        description: "Le flux est actuellement indisponible",
        duration: 5000
      });
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 10000);
    retryCountRef.current++;
    console.log(`🔄 Retry ${retryCountRef.current}/5 in ${delay}ms`);
    retryTimeoutRef.current = setTimeout(() => {
      retryFn();
    }, delay);
  }, []);

  // Créer player MPEGTS
  const createMpegtsPlayer = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    console.log('🎬 Creating MPEGTS player...');
    
    // Détection Mixed Content : si la page est HTTPS et l'URL est HTTP, utiliser le proxy
    const isHttpsPage = window.location.protocol === 'https:';
    const isHttpStream = streamUrl.toLowerCase().startsWith('http://');
    
    if (isHttpsPage && isHttpStream && !useProxyRef.current) {
      console.log('🔒 Mixed Content detected, using proxy automatically');
      useProxyRef.current = true;
    }
    
    const url = useProxyRef.current ? getProxiedUrl(streamUrl) : streamUrl;
    const player = mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url: url,
      cors: true,
      withCredentials: false
    }, {
      enableWorker: true,
      enableStashBuffer: true,
      stashInitialSize: 5 * 1024 * 1024,      // 5MB buffer initial (augmenté pour stabilité extrême)
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 90,     // 90s historique (augmenté)
      autoCleanupMinBackwardDuration: 45,     // 45s minimum (augmenté)
      liveBufferLatencyChasing: false,        // DÉSACTIVÉ pour stabilité
      liveBufferLatencyMaxLatency: 20,        // Tolérance maximale (augmenté à 20s)
      liveBufferLatencyMinRemain: 8,          // Garder 8s minimum (augmenté)
      fixAudioTimestampGap: true,
      lazyLoad: false,                        // Désactivé pour prefetch immédiat
      deferLoadAfterSourceOpen: false,
      accurateSeek: false,
      seekType: 'range',
      isLive: true,
      reuseRedirectedURL: true
    });
    player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: any) => {
      console.error('🔴 MPEGTS Error:', errorType, errorDetail);

      // Tenter avec proxy si pas encore fait
      if (!useProxyRef.current && errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
        console.log('🔄 Switching to proxy...');
        useProxyRef.current = true;
        cleanup();
        scheduleRetry(() => createMpegtsPlayer());
      } else {
        // Retry avec même config
        cleanup();
        scheduleRetry(() => createMpegtsPlayer());
      }
    });
    player.on(mpegts.Events.LOADING_COMPLETE, () => {
      console.log('✅ MPEGTS loading complete');
    });
    player.on(mpegts.Events.METADATA_ARRIVED, () => {
      console.log('📊 Metadata arrived');
    });
    player.attachMediaElement(video);
    player.load();
    mpegtsRef.current = player;
    
    // Watchdog: ultra-réactif pour stabilité maximale sur longue durée
    const watchdogInterval = setInterval(() => {
      if (!video || video.readyState < 2) return;
      
      const bufferLevel = video.buffered.length > 0 
        ? video.buffered.end(0) - video.currentTime 
        : 0;
      
      // Buffer critique: seuil augmenté à 1.5s pour plus de marge
      if (bufferLevel < 1.5 && !video.paused) {
        console.warn(`🚨 Buffer critique (${bufferLevel.toFixed(2)}s), recovery immédiat...`);
        try {
          if (player && typeof player.unload === 'function') {
            const currentTime = video.currentTime;
            player.unload();
            player.load();
            // Restaurer la position avec un léger décalage pour éviter les trous
            video.currentTime = Math.max(0, currentTime - 0.5);
            video.play().catch(() => {});
          }
        } catch (e) {
          console.error('Recovery failed:', e);
        }
      }
      
      // Détection de gel: seuil réduit à 1.5s pour réaction plus rapide
      const now = Date.now();
      if (!video.paused && video.currentTime === (video as any)._lastCurrentTime) {
        const frozenTime = now - ((video as any)._lastTimeUpdate || now);
        if (frozenTime > 1500) {
          console.warn('🚨 Vidéo gelée détectée, recovery multi-étapes...');
          
          // Essayer d'abord un simple play()
          video.play().catch(() => {
            // Si ça échoue, reload complet
            console.warn('🔄 Simple play() échoué, reload complet...');
            try {
              if (player && typeof player.unload === 'function') {
                const currentTime = video.currentTime;
                player.unload();
                player.load();
                video.currentTime = currentTime;
                video.play().catch(() => {});
              }
            } catch (e) {
              console.error('Full reload failed:', e);
            }
          });
          
          (video as any)._lastTimeUpdate = now;
        }
      } else {
        (video as any)._lastCurrentTime = video.currentTime;
        (video as any)._lastTimeUpdate = now;
      }
      
      // Détection stall additionnel: vérifier si readyState passe à HAVE_CURRENT_DATA
      if (video.readyState === 2 && !video.paused) {
        // HAVE_CURRENT_DATA mais pas HAVE_FUTURE_DATA = problème potentiel
        console.warn('⚠️ ReadyState=2 détecté, préchargement insuffisant');
      }
    }, 1000); // Réduire l'intervalle à 1s pour plus de réactivité
    
    // Stocker watchdog pour cleanup
    (player as any)._watchdogInterval = watchdogInterval;
    
    // === MAINTENANCE LONG-TERME: nettoyage préventif tous les 20 min ===
    const maintenanceInterval = setInterval(() => {
      if (!video || !player) return;
      
      const uptimeMinutes = (Date.now() - uptimeStartRef.current) / 1000 / 60;
      console.log(`🔧 Maintenance préventive (uptime: ${uptimeMinutes.toFixed(1)}min)`);
      
      try {
        // Vérifier la qualité de lecture
        const quality = (video as any).getVideoPlaybackQuality?.();
        if (quality) {
          const dropRate = quality.droppedVideoFrames / (quality.totalVideoFrames || 1);
          playbackQualityCheckRef.current++;
          
          // Si taux de frames perdus > 5% après plusieurs checks, soft reload
          if (dropRate > 0.05 && playbackQualityCheckRef.current > 3) {
            console.warn(`⚠️ Qualité dégradée (${(dropRate * 100).toFixed(1)}% frames perdus), soft reload...`);
            try {
              const currentTime = video.currentTime;
              player.unload();
              player.load();
              video.currentTime = currentTime;
              video.play().catch(() => {});
              playbackQualityCheckRef.current = 0;
            } catch (e) {
              console.error('Soft reload failed:', e);
            }
          }
        }
        
        // Nettoyage buffers manuels si disponible
        if (video.buffered.length > 0) {
          const bufferedEnd = video.buffered.end(video.buffered.length - 1);
          const bufferedStart = video.buffered.start(0);
          const totalBuffered = bufferedEnd - bufferedStart;
          
          // Si plus de 90s buffered, forcer cleanup
          if (totalBuffered > 90) {
            console.log(`🧹 Buffer trop grand (${totalBuffered.toFixed(1)}s), cleanup...`);
            try {
              const currentTime = video.currentTime;
              player.unload();
              player.load();
              video.currentTime = currentTime;
              video.play().catch(() => {});
            } catch (e) {}
          }
        }
        
        lastMemoryCleanupRef.current = Date.now();
      } catch (e) {
        console.warn('Maintenance error:', e);
      }
    }, 20 * 60 * 1000); // 20 minutes
    
    (player as any)._maintenanceInterval = maintenanceInterval;
    memoryCleanupIntervalRef.current = maintenanceInterval;
    
    if (autoPlay) {
      setTimeout(() => {
        video.play().then(() => {
          console.log('✅ MPEGTS playback started');
          retryCountRef.current = 0;
          setErrorMessage(null);
          toast.success("✅ Lecture démarrée", {
            description: `MPEG-TS • ${networkSpeed}`,
            duration: 2000
          });
        }).catch(err => {
          if (err.name !== 'AbortError') {
            console.error('❌ Play failed:', err);
            scheduleRetry(() => createMpegtsPlayer());
          }
        });
      }, 500);
    }
  }, [streamUrl, autoPlay, cleanup, scheduleRetry, getOptimalBufferSize, networkSpeed]);

  // Créer player HLS
  const createHlsPlayer = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!Hls.isSupported()) {
      toast.error("HLS non supporté");
      return;
    }
    console.log('🎬 Creating HLS player...');

    // Configuration optimisée pour stabilité maximale en production
    const hls = new Hls({
      debug: hlsDebugMode.current,
      enableWorker: true,
      
      // ========== BUFFER OPTIMISÉ STABILITÉ EXTRÊME ==========
      maxBufferLength: 60,              // 60s pour maximum stabilité long-terme
      maxMaxBufferLength: 90,           // Cap à 90s (augmenté)
      maxBufferSize: 70 * 1000 * 1000,  // 70MB (augmenté pour éviter underrun)
      maxBufferHole: 0.3,               // Tolérance réduite à 300ms pour meilleure continuité
      
      // ========== LIVE SYNC - Optimisé stabilité ==========
      liveSyncDurationCount: 4,         // 4 fragments (augmenté pour marge)
      liveMaxLatencyDurationCount: 10,  // Max 10 segments (plus tolérant)
      liveDurationInfinity: false,
      
      // ========== BACK BUFFER (NETTOYAGE AUTO) ==========
      backBufferLength: 15,             // 15s en arrière (sera nettoyé auto)
      
      // ========== CHARGEMENT ROBUSTE ==========
      manifestLoadingTimeOut: 10000,
      fragLoadingTimeOut: 20000,        // 20s timeout fragments
      levelLoadingTimeOut: 10000,
      manifestLoadingMaxRetry: 4,
      levelLoadingMaxRetry: 4,
      fragLoadingMaxRetry: 6,           // 6 tentatives par fragment
      manifestLoadingRetryDelay: 500,
      levelLoadingRetryDelay: 500,
      fragLoadingRetryDelay: 500,       // Délai initial retry
      
      // ========== ABR STABLE ==========
      abrEwmaFastLive: 3,
      abrEwmaSlowLive: 7,
      abrBandWidthFactor: 0.95,
      abrBandWidthUpFactor: 0.7,
      abrMaxWithRealBitrate: true,
      minAutoBitrate: 0,
      
      // ========== ANTI-STALL ==========
      maxStarvationDelay: 4,
      maxLoadingDelay: 4,
      highBufferWatchdogPeriod: 2,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 3,
      
      // ========== PRÉCHARGEMENT ==========
      startLevel: -1,
      autoStartLoad: true,
      startPosition: -1,
      
      // ========== PERFORMANCE ==========
      maxFragLookUpTolerance: 0.2,
      progressive: true,
      lowLatencyMode: true,
      maxLiveSyncPlaybackRate: 1.02     // Rattrapage 102%
    });
    // Logs debug optionnels
    if (hlsDebugMode.current) {
      hls.on(Hls.Events.LEVEL_SWITCHED, (e, d) => 
        console.debug('[HLS] LEVEL_SWITCHED', d.level)
      );
      hls.on(Hls.Events.BUFFER_APPENDED, (e, d) => 
        console.debug('[HLS] BUFFER_APPENDED', d.timeRanges)
      );
      hls.on(Hls.Events.FRAG_LOADED, (e, d) => 
        console.debug('[HLS] FRAG_LOADED', d.frag.sn)
      );
    }

    hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      console.log('✅ HLS Manifest parsed:', data.levels.length, 'levels');
      const qualities: StreamQuality[] = data.levels.map((level: any, index: number) => ({
        id: `level-${index}`,
        label: `${level.height}p`,
        bandwidth: level.bitrate,
        resolution: `${level.width}x${level.height}`,
        url: ''
      }));
      setAvailableQualities(qualities);
      
      if (autoPlay) {
        video.play().then(() => {
          console.log('✅ HLS playback started');
          retryCountRef.current = 0;
          fragErrorCountRef.current = 0;
          setErrorMessage(null);
          toast.success("✅ Lecture démarrée", {
            description: `HLS • ${networkSpeed}`,
            duration: 2000
          });
        }).catch(err => {
          if (err.name !== 'AbortError') {
            console.error('❌ Play failed:', err);
          }
        });
      }
    });
    
    // Reset compteur erreurs sur succès fragment
    hls.on(Hls.Events.FRAG_LOADED, () => {
      fragErrorCountRef.current = 0;
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
      setCurrentLevel(data.level);
    });

    // Gestion erreurs avec retry exponentiel et backoff
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (hlsDebugMode.current) {
        console.debug('[HLS ERROR]', data.type, data.details, 'Fatal:', data.fatal);
      }
      
      if (!data.fatal) {
        // Erreurs non-fatales : récupération douce
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (data.details === 'bufferStalledError' || 
              data.details === 'bufferAppendingError' ||
              data.details === 'bufferSeekOverHole') {
            console.log('🔧 Auto-recovering buffer issue...');
            setTimeout(() => {
              if (videoRef.current && hlsRef.current) {
                videoRef.current.play().catch(() => {});
              }
            }, 1000);
          }
        }
        return;
      }

      // Erreurs FATALES
      console.error('🔴 HLS Fatal Error:', data.type, data.details);

      // Retry avec backoff exponentiel pour fragment errors
      if (data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR || 
          data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT) {
        fragErrorCountRef.current++;
        
        if (fragErrorCountRef.current <= 6) {
          const delay = 500 * Math.pow(1.5, fragErrorCountRef.current - 1);
          console.log(`🔄 Retry fragment ${fragErrorCountRef.current}/6 in ${delay}ms`);
          
          setTimeout(() => {
            if (hlsRef.current) {
              hlsRef.current.startLoad();
            }
          }, delay);
          return;
        }
      }

      // Autres erreurs fatales
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          console.log('🔄 Network error, retrying with startLoad...');
          scheduleRetry(() => {
            if (hlsRef.current) {
              hlsRef.current.startLoad();
            }
          });
          break;
          
        case Hls.ErrorTypes.MEDIA_ERROR:
          console.log('🔄 Media error, attempting recovery...');
          try {
            hls.recoverMediaError();
          } catch (e) {
            console.error('Recovery failed, recreating player');
            cleanup();
            scheduleRetry(() => createHlsPlayer());
          }
          break;
          
        default:
          cleanup();
          scheduleRetry(() => createHlsPlayer());
          break;
      }
    });

    // Surveillance du buffering
    hls.on(Hls.Events.BUFFER_APPENDING, () => {
      setIsLoading(false);
    });

    hls.on(Hls.Events.BUFFER_APPENDED, () => {
      setIsLoading(false);
    });
    
    // === MAINTENANCE LONG-TERME HLS: vérification périodique ===
    const hlsMaintenanceInterval = setInterval(() => {
      if (!video || !hls) return;
      
      const uptimeMinutes = (Date.now() - uptimeStartRef.current) / 1000 / 60;
      
      // Vérifier la santé du player tous les 15 min
      if (uptimeMinutes > 15 && uptimeMinutes % 15 < 0.5) {
        console.log(`🔧 HLS Maintenance (uptime: ${uptimeMinutes.toFixed(1)}min)`);
        
        try {
          // Vérifier qualité playback
          const quality = (video as any).getVideoPlaybackQuality?.();
          if (quality) {
            const dropRate = quality.droppedVideoFrames / (quality.totalVideoFrames || 1);
            
            if (dropRate > 0.08) { // Seuil 8% pour HLS
              console.warn(`⚠️ HLS qualité dégradée, recoverMediaError...`);
              try {
                hls.recoverMediaError();
              } catch (e) {}
            }
          }
          
          // Vérifier si le buffer est sain
          const bufferInfo = hls.media?.buffered;
          if (bufferInfo && bufferInfo.length > 0) {
            const totalBuffered = bufferInfo.end(bufferInfo.length - 1) - bufferInfo.start(0);
            if (totalBuffered > 120) { // Si >2min buffered
              console.log('🧹 HLS buffer cleanup...');
              const currentTime = video.currentTime;
              hls.stopLoad();
              hls.startLoad(currentTime - 5);
            }
          }
        } catch (e) {
          console.warn('HLS maintenance error:', e);
        }
      }
    }, 60 * 1000); // Vérifier chaque minute
    
    (hls as any)._maintenanceInterval = hlsMaintenanceInterval;
    memoryCleanupIntervalRef.current = hlsMaintenanceInterval;
    hls.loadSource(getProxiedUrl(streamUrl));
    hls.attachMedia(video);
    hlsRef.current = hls;
  }, [streamUrl, autoPlay, cleanup, scheduleRetry, networkSpeed]);

  // Swap stream avec préchargement et transition fluide
  const swapStream = useCallback(async (newUrl: string) => {
    if (isTransitioningRef.current) {
      console.log('⏳ Swap already in progress, skipping...');
      return;
    }
    
    isTransitioningRef.current = true;
    setIsLoading(true);
    
    const video = videoRef.current;
    if (!video) {
      isTransitioningRef.current = false;
      return;
    }

    const oldHls = hlsRef.current;
    const newType = detectStreamType(newUrl);
    
    console.log(`🔄 Swapping stream to ${newType}: ${newUrl}`);

    try {
      // Pour HLS -> HLS, swap optimisé
      if (newType === 'hls' && Hls.isSupported()) {
        // Créer nouvelle instance
        const newHls = new Hls({
          debug: hlsDebugMode.current,
          enableWorker: true,
          maxBufferLength: 60,
          maxBufferSize: 60 * 1000 * 1000,
          maxBufferHole: 0.7,
          liveSyncDurationCount: 3,
          fragLoadingTimeOut: 20000,
          fragLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 500,
          autoStartLoad: true,
          startPosition: -1,
        });

        // Précharger manifeste
        try {
          await fetch(getProxiedUrl(newUrl), { method: 'HEAD', mode: 'cors' });
        } catch (e) {
          console.warn('Manifest prefetch failed, continuing anyway');
        }

        // Attendre premier fragment chargé
        const readyPromise = new Promise<void>((resolve, reject) => {
          const onFragLoaded = () => {
            cleanup();
            resolve();
          };
          const onError = (ev: any, data: any) => {
            if (data?.fatal) {
              cleanup();
              reject(data);
            }
          };
          const cleanup = () => {
            newHls.off(Hls.Events.FRAG_LOADED, onFragLoaded);
            newHls.off(Hls.Events.ERROR, onError);
          };
          
          newHls.on(Hls.Events.FRAG_LOADED, onFragLoaded);
          newHls.on(Hls.Events.ERROR, onError);
          
          // Timeout de sécurité
          setTimeout(() => {
            cleanup();
            resolve();
          }, 5000);
        });

        // Charger source et attacher
        newHls.loadSource(getProxiedUrl(newUrl));
        newHls.attachMedia(video);
        
        await readyPromise;

        // Détacher et détruire l'ancien proprement
        if (oldHls) {
          try {
            oldHls.stopLoad();
            oldHls.detachMedia();
            oldHls.destroy();
          } catch (e) {
            console.warn('Old HLS cleanup warning:', e);
          }
        }

        hlsRef.current = newHls;
        playerTypeRef.current = 'hls';
        
        // Setup event handlers pour le nouveau player
        setupHlsEventHandlers(newHls);

        // Relancer lecture
        video.play().catch(() => {});
        
      } else {
        // Fallback: full cleanup + recreate
        cleanup();
        setTimeout(() => {
          playerTypeRef.current = newType;
          if (newType === 'hls') {
            createHlsPlayer();
          } else {
            createMpegtsPlayer();
          }
        }, 200);
      }

    } catch (error) {
      console.error('Swap stream error:', error);
      cleanup();
      setTimeout(() => initPlayer(), 300);
    } finally {
      isTransitioningRef.current = false;
      fragErrorCountRef.current = 0;
      retryCountRef.current = 0;
    }
  }, [cleanup, createHlsPlayer, createMpegtsPlayer]);

  // Setup event handlers pour instance HLS (factorisation)
  const setupHlsEventHandlers = useCallback((hls: Hls) => {
    hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      const qualities: StreamQuality[] = data.levels.map((level: any, index: number) => ({
        id: `level-${index}`,
        label: `${level.height}p`,
        bandwidth: level.bitrate,
        resolution: `${level.width}x${level.height}`,
        url: ''
      }));
      setAvailableQualities(qualities);
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
      setCurrentLevel(data.level);
    });

    hls.on(Hls.Events.FRAG_LOADED, () => {
      fragErrorCountRef.current = 0;
      setIsLoading(false);
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      // Gestion erreurs identique à createHlsPlayer
      if (!data.fatal) return;
      
      if (data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR || 
          data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT) {
        fragErrorCountRef.current++;
        if (fragErrorCountRef.current <= 6) {
          const delay = 500 * Math.pow(1.5, fragErrorCountRef.current - 1);
          setTimeout(() => hls.startLoad(), delay);
          return;
        }
      }

      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        try {
          hls.recoverMediaError();
        } catch (e) {
          cleanup();
          setTimeout(() => createHlsPlayer(), 500);
        }
      }
    });
  }, [cleanup, createHlsPlayer]);

  // Init player selon le type détecté
  const initPlayer = useCallback(() => {
    setIsLoading(true);
    setErrorMessage(null);
    retryCountRef.current = 0;
    fragErrorCountRef.current = 0;
    
    // Cleanup complet de l'ancien flux
    cleanup();
    
    // Délai pour assurer destruction complète avant nouveau flux
    setTimeout(() => {
      useProxyRef.current = false;
      playerTypeRef.current = detectStreamType(streamUrl);
      console.log(`🎯 Detected stream type: ${playerTypeRef.current}`);
      
      if (playerTypeRef.current === 'hls') {
        createHlsPlayer();
      } else {
        createMpegtsPlayer();
      }
    }, 150);
  }, [streamUrl, cleanup, createHlsPlayer, createMpegtsPlayer]);

  // Buffer health monitoring
  useEffect(() => {
    if (!videoRef.current) return;
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused) return;
      if (video.buffered.length > 0) {
        const buffered = video.buffered.end(0) - video.currentTime;
        const health = Math.min(100, Math.round(buffered / 10 * 100));
        setBufferHealth(health);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Video events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handlePlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
    };
    const handlePause = () => setIsPlaying(false);
    const handleWaiting = () => setIsLoading(true);
    const handlePlaying = () => setIsLoading(false);
    const handleCanPlay = () => setIsLoading(false);
    const handleError = (e: Event) => {
      console.error('❌ Video element error:', e);
      setIsLoading(false);
    };
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleError);
    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
    };
  }, []);

  // Init on mount + swap optimisé sur changement URL
  useEffect(() => {
    const isFirstMount = !hlsRef.current && !mpegtsRef.current;
    
    if (isFirstMount) {
      // Premier mount : init normale + reset uptime
      uptimeStartRef.current = Date.now();
      lastMemoryCleanupRef.current = Date.now();
      playbackQualityCheckRef.current = 0;
      initPlayer();
    } else {
      // Changement URL : utiliser swap optimisé pour HLS
      const currentType = playerTypeRef.current;
      const newType = detectStreamType(streamUrl);
      
      if (currentType === 'hls' && newType === 'hls') {
        swapStream(streamUrl);
      } else {
        // Type différent : full recreate
        initPlayer();
      }
    }
    
    return cleanup;
  }, [streamUrl, initPlayer, cleanup, swapStream]);

  // Volume & playback rate
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Controls
  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
    } else {
      video.play().catch(err => {
        if (err.name !== 'AbortError') {
          console.error('Play error:', err);
        }
      });
    }
  };
  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    if (newVolume > 0 && isMuted) {
      setIsMuted(false);
    }
  };
  const handleMuteToggle = () => setIsMuted(!isMuted);
  
  // Plein écran avec support mobile complet (iOS/Android)
  const handleFullscreen = () => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;

    try {
      // Vérifier si déjà en plein écran
      const isFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );

      if (isFullscreen) {
        // Sortir du plein écran
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          (document as any).webkitExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
          (document as any).mozCancelFullScreen();
        } else if ((document as any).msExitFullscreen) {
          (document as any).msExitFullscreen();
        }
      } else {
        // Entrer en plein écran
        // Sur iOS, utiliser la vidéo native en plein écran
        if ((video as any).webkitEnterFullscreen) {
          (video as any).webkitEnterFullscreen();
        } else if ((video as any).webkitRequestFullscreen) {
          (video as any).webkitRequestFullscreen();
        } else if (container.requestFullscreen) {
          container.requestFullscreen();
        } else if ((container as any).webkitRequestFullscreen) {
          (container as any).webkitRequestFullscreen();
        } else if ((container as any).mozRequestFullScreen) {
          (container as any).mozRequestFullScreen();
        } else if ((container as any).msRequestFullscreen) {
          (container as any).msRequestFullscreen();
        }
        
        // Verrouiller l'orientation en paysage sur mobile si possible
        if (screen.orientation && (screen.orientation as any).lock) {
          (screen.orientation as any).lock('landscape').catch(() => {
            console.log('Orientation lock not supported');
          });
        }
      }
      
      toast.success(isFullscreen ? "Mode normal" : "Mode plein écran");
    } catch (error) {
      console.warn('Fullscreen error:', error);
      toast.error("Mode plein écran non disponible");
    }
  };
  const handlePiP = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
        toast.success("📺 Picture-in-Picture activé");
      }
    } catch (err) {
      toast.error("Picture-in-Picture non disponible");
    }
  };
  const handleQualityChange = useCallback((newQuality: string) => {
    setQuality(newQuality);
    
    if (playerTypeRef.current === 'hls' && hlsRef.current) {
      // HLS: changement de niveau direct
      if (newQuality === 'auto') {
        hlsRef.current.currentLevel = -1;
        toast.success('⚡ Qualité automatique', {
          description: 'Adaptation au débit réseau'
        });
      } else {
        const qualityMap: { [key: string]: number } = {
          'low': 0,
          'medium': Math.floor(availableQualities.length / 2),
          'high': availableQualities.length - 1
        };
        const targetLevel = qualityMap[newQuality] || -1;
        if (targetLevel >= 0 && targetLevel < availableQualities.length) {
          hlsRef.current.currentLevel = targetLevel;
          const quality = availableQualities[targetLevel];
          toast.success(`Qualité: ${quality?.label}`, {
            description: `${(quality?.bandwidth / 1000000).toFixed(1)} Mbps`
          });
        }
      }
    } else if (playerTypeRef.current === 'mpegts' && mpegtsRef.current) {
      // MPEG-TS: ajuster la stratégie de buffering selon la qualité demandée
      const video = videoRef.current;
      if (!video) return;
      
      try {
        const player = mpegtsRef.current;
        const currentTime = video.currentTime;
        const wasPlaying = !video.paused;
        
        // Recréer le player avec des paramètres adaptés à la qualité
        player.pause();
        player.unload();
        
        // Configuration adaptée selon la qualité
        let config = {
          type: 'mpegts',
          isLive: true,
          url: useProxyRef.current ? getProxiedUrl(streamUrl) : streamUrl,
          cors: true,
          withCredentials: false
        };
        
        let options: any = {
          enableWorker: true,
          enableStashBuffer: true,
          autoCleanupSourceBuffer: true,
          liveBufferLatencyChasing: false,
          fixAudioTimestampGap: true,
          lazyLoad: false,
          deferLoadAfterSourceOpen: false,
          accurateSeek: false,
          seekType: 'range',
          isLive: true,
          reuseRedirectedURL: true
        };
        
        // Ajuster les buffers selon la qualité
        if (newQuality === 'low') {
          // Basse qualité : buffers minimaux pour stabilité maximale
          options.stashInitialSize = 2 * 1024 * 1024; // 2MB
          options.autoCleanupMaxBackwardDuration = 40;
          options.autoCleanupMinBackwardDuration = 20;
          options.liveBufferLatencyMaxLatency = 10;
          options.liveBufferLatencyMinRemain = 4;
          toast.success('💾 Qualité basse', {
            description: 'Stabilité maximale, latence réduite'
          });
        } else if (newQuality === 'medium') {
          // Qualité moyenne : équilibre
          options.stashInitialSize = 3 * 1024 * 1024; // 3MB
          options.autoCleanupMaxBackwardDuration = 50;
          options.autoCleanupMinBackwardDuration = 25;
          options.liveBufferLatencyMaxLatency = 12;
          options.liveBufferLatencyMinRemain = 5;
          toast.success('📺 Qualité moyenne', {
            description: 'Équilibre stabilité/qualité'
          });
        } else if (newQuality === 'high') {
          // Haute qualité : buffers larges
          options.stashInitialSize = 5 * 1024 * 1024; // 5MB
          options.autoCleanupMaxBackwardDuration = 70;
          options.autoCleanupMinBackwardDuration = 35;
          options.liveBufferLatencyMaxLatency = 18;
          options.liveBufferLatencyMinRemain = 7;
          toast.success('🎯 Qualité haute', {
            description: 'Meilleure qualité, buffers augmentés'
          });
        } else {
          // Auto : adaptatif selon le réseau
          const speed = getNetworkSpeed();
          if (speed === 'fast') {
            options.stashInitialSize = 4 * 1024 * 1024;
            options.autoCleanupMaxBackwardDuration = 60;
            options.autoCleanupMinBackwardDuration = 30;
            options.liveBufferLatencyMaxLatency = 15;
            options.liveBufferLatencyMinRemain = 6;
          } else if (speed === 'medium') {
            options.stashInitialSize = 3 * 1024 * 1024;
            options.autoCleanupMaxBackwardDuration = 50;
            options.autoCleanupMinBackwardDuration = 25;
            options.liveBufferLatencyMaxLatency = 12;
            options.liveBufferLatencyMinRemain = 5;
          } else {
            options.stashInitialSize = 2 * 1024 * 1024;
            options.autoCleanupMaxBackwardDuration = 40;
            options.autoCleanupMinBackwardDuration = 20;
            options.liveBufferLatencyMaxLatency = 10;
            options.liveBufferLatencyMinRemain = 4;
          }
          toast.success('⚡ Mode adaptatif', {
            description: `Optimisé pour ${speed === 'fast' ? '4G/5G' : speed === 'medium' ? '3G' : '2G'}`
          });
        }
        
        // Créer nouveau player avec nouvelle config
        const newPlayer = mpegts.createPlayer(config, options);
        
        // Copier les event handlers
        newPlayer.on(mpegts.Events.ERROR, (errorType: string, errorDetail: any) => {
          console.error('🔴 MPEGTS Error après changement qualité:', errorType, errorDetail);
          if (!useProxyRef.current && errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
            useProxyRef.current = true;
            cleanup();
            scheduleRetry(() => createMpegtsPlayer());
          } else {
            cleanup();
            scheduleRetry(() => createMpegtsPlayer());
          }
        });
        
        newPlayer.attachMediaElement(video);
        newPlayer.load();
        
        // Restaurer l'état
        if (currentTime > 0) {
          video.currentTime = currentTime;
        }
        if (wasPlaying) {
          setTimeout(() => {
            video.play().catch(() => {});
          }, 200);
        }
        
        mpegtsRef.current = newPlayer;
        
      } catch (error) {
        console.error('Erreur changement qualité MPEG-TS:', error);
        toast.error('Erreur changement qualité', {
          description: 'Le flux va être rechargé'
        });
        cleanup();
        setTimeout(() => createMpegtsPlayer(), 500);
      }
    }
  }, [availableQualities, streamUrl, cleanup, scheduleRetry, createMpegtsPlayer]);

  // Double-tap seek
  const handleVideoClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const side = clickX < rect.width / 2 ? 'left' : 'right';
    if (now - lastTapTimeRef.current < 300 && lastTapSideRef.current === side) {
      const seekAmount = side === 'left' ? -10 : 10;
      video.currentTime = Math.max(0, video.currentTime + seekAmount);
      setShowSeekFeedback({
        direction: side === 'left' ? 'backward' : 'forward',
        show: true
      });
      toast.info(side === 'left' ? '⏪ -10s' : '⏩ +10s', {
        duration: 1000
      });
      setTimeout(() => setShowSeekFeedback({
        direction: 'forward',
        show: false
      }), 500);
      lastTapTimeRef.current = 0;
      lastTapSideRef.current = null;
    } else {
      lastTapTimeRef.current = now;
      lastTapSideRef.current = side;
    }
  };

  // Keyboard
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          handlePlayPause();
          break;
        case 'KeyF':
          handleFullscreen();
          break;
        case 'KeyM':
          handleMuteToggle();
          break;
        case 'KeyP':
          handlePiP();
          break;
        case 'KeyS':
          setShowStats(s => !s);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(v => Math.min(1, v + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(v => Math.max(0, v - 0.1));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          video.currentTime = video.currentTime + 10;
          break;
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);
  const handleMouseMove = () => {
    setShowControls(true);
    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
    }
    hideControlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showSettings) {
        setShowControls(false);
      }
    }, 3000);
  };
  const currentQualityLabel = playerTypeRef.current === 'hls' && currentLevel >= 0 ? availableQualities[currentLevel]?.label || 'Auto' : 'Live';
  return <div ref={containerRef} className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-2xl" onMouseMove={handleMouseMove} onMouseLeave={() => isPlaying && !showSettings && setShowControls(false)} onClick={handleVideoClick}>
      <video 
        ref={videoRef} 
        className="absolute inset-0 w-full h-full" 
        playsInline 
        preload="auto"
        webkit-playsinline="true"
        x-webkit-airplay="allow"
        controlsList="nodownload"
      />

      {/* Quality indicator */}
      {!isLoading && !errorMessage && videoMetrics.resolution !== 'N/A'}

      {/* Stats */}
      <PlayerStats videoElement={videoRef.current} playerType={playerTypeRef.current} useProxy={useProxyRef.current} bufferHealth={bufferHealth} isVisible={showStats} networkSpeed={networkSpeed} bandwidthMbps={realBandwidth.currentBitrate || 0} bandwidthTrend="stable" realBitrate={realBandwidth.currentBitrate} healthStatus={healthStatus} abrState={{
      currentQuality: currentLevel >= 0 ? availableQualities[currentLevel] : null,
      targetQuality: null,
      isAdapting: false,
      adaptationReason: `${playerTypeRef.current} native`
    }} />

      {/* Settings */}
      <PlayerSettings playbackRate={playbackRate} onPlaybackRateChange={setPlaybackRate} quality={quality} onQualityChange={handleQualityChange} isVisible={showSettings} onClose={() => setShowSettings(false)} availableQualities={availableQualities} />

      {/* Seek feedback */}
      {showSeekFeedback.show && <div className={`absolute top-1/2 ${showSeekFeedback.direction === 'backward' ? 'left-8' : 'right-8'} -translate-y-1/2 animate-in fade-in zoom-in duration-200`}>
          <div className="bg-black/80 backdrop-blur-xl rounded-full p-4">
            <span className="text-4xl">{showSeekFeedback.direction === 'backward' ? '⏪' : '⏩'}</span>
          </div>
        </div>}

      {/* Loading */}
      {isLoading && !errorMessage && <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-40">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 animate-spin text-white" />
            <p className="text-white font-medium">Chargement du flux...</p>
            {retryCountRef.current > 0 && <p className="text-white/70 text-sm">Tentative {retryCountRef.current}/5</p>}
          </div>
        </div>}

      {/* Error */}
      {errorMessage && <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-40">
          <div className="flex flex-col items-center gap-4 max-w-md px-6">
            <div className="text-red-500 text-6xl">⚠️</div>
            <p className="text-white font-bold text-xl text-center">{errorMessage}</p>
            <Button onClick={() => {
          retryCountRef.current = 0;
          initPlayer();
        }} className="bg-primary hover:bg-primary/90">
              Réessayer
            </Button>
          </div>
        </div>}

      {/* Controls */}
      {showControls && !errorMessage && <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 z-30">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={handlePlayPause} className="text-white hover:bg-white/20">
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </Button>

            <Button variant="ghost" size="icon" onClick={handleMuteToggle} className="text-white hover:bg-white/20">
              {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </Button>

            <Slider value={[isMuted ? 0 : volume]} onValueChange={handleVolumeChange} max={1} step={0.1} className="w-24" />

            <div className="flex-1" />

            <Button variant="ghost" size="icon" onClick={() => setShowStats(!showStats)} className="text-white hover:bg-white/20">
              <BarChart3 className="w-5 h-5" />
            </Button>

            <Button variant="ghost" size="icon" onClick={() => setShowSettings(!showSettings)} className="text-white hover:bg-white/20">
              <SettingsIcon className="w-5 h-5" />
            </Button>

            <Button variant="ghost" size="icon" onClick={handlePiP} className="text-white hover:bg-white/20">
              <PictureInPicture className="w-5 h-5" />
            </Button>

            <Button variant="ghost" size="icon" onClick={handleFullscreen} className="text-white hover:bg-white/20">
              <Maximize className="w-5 h-5" />
            </Button>
          </div>
        </div>}
    </div>;
};