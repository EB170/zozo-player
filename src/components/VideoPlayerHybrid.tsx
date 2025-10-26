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
    
    if (mpegtsRef.current) {
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
      stashInitialSize: getOptimalBufferSize(),
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 30,     // Augmenté pour moins de nettoyages
      autoCleanupMinBackwardDuration: 15,     // Plus de marge
      liveBufferLatencyChasing: networkSpeed === 'fast',
      liveBufferLatencyMaxLatency: 8,         // Tolérance augmentée
      liveBufferLatencyMinRemain: 2,          // Plus de buffer de sécurité
      fixAudioTimestampGap: true,
      lazyLoad: false,
      lazyLoadMaxDuration: 3 * 60,            // 3 min cache
      lazyLoadRecoverDuration: 30,            // 30s recovery
      deferLoadAfterSourceOpen: false
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
      
      // ========== BUFFER OPTIMISÉ STABILITÉ ==========
      maxBufferLength: 60,              // 60s buffer pour stabilité maximale
      maxMaxBufferLength: 90,           // Cap à 90s
      maxBufferSize: 60 * 1000 * 1000,  // 60MB
      maxBufferHole: 0.7,               // Tolérance 700ms pour éviter skip
      
      // ========== LIVE SYNC ==========
      liveSyncDurationCount: 3,         // 3 fragments du live
      liveMaxLatencyDurationCount: 6,   // Max 6 segments de retard
      liveDurationInfinity: false,
      
      // ========== BACK BUFFER ==========
      backBufferLength: 10,             // 10s en arrière
      
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
      // Premier mount : init normale
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
  const handleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
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
      if (newQuality === 'auto') {
        hlsRef.current.currentLevel = -1;
        toast.info('Qualité automatique');
      } else {
        const qualityMap: {
          [key: string]: number;
        } = {
          'low': 0,
          'medium': Math.floor(availableQualities.length / 2),
          'high': availableQualities.length - 1
        };
        const targetLevel = qualityMap[newQuality] || -1;
        if (targetLevel >= 0) {
          hlsRef.current.currentLevel = targetLevel;
          toast.success(`Qualité: ${availableQualities[targetLevel]?.label}`);
        }
      }
    } else {
      toast.info(`Qualité: ${newQuality}`, {
        description: 'MPEG-TS utilise une qualité fixe'
      });
    }
  }, [availableQualities]);

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
      <video ref={videoRef} className="absolute inset-0 w-full h-full" playsInline preload="auto" />

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