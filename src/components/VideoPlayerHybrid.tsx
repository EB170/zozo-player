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

export const VideoPlayerHybrid = ({ streamUrl, autoPlay = true }: VideoPlayerProps) => {
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
  const [showSeekFeedback, setShowSeekFeedback] = useState<{direction: 'forward' | 'backward', show: boolean}>({direction: 'forward', show: false});
  const [availableQualities, setAvailableQualities] = useState<StreamQuality[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();

  const videoMetrics = useVideoMetrics(videoRef.current);
  const realBandwidth = useRealBandwidth();
  const { health: healthStatus } = useHealthMonitor(videoRef.current);

  const networkSpeed = getNetworkSpeed();

  // Cleanup complet
  const cleanup = useCallback(() => {
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
    
    if (bandwidth > 10) baseSize = 1536;
    else if (bandwidth > 6) baseSize = 1024;
    else if (bandwidth > 3) baseSize = 768;
    else baseSize = 512;
    
    if (networkSpeed === 'slow') baseSize = Math.round(baseSize * 0.7);
    else if (networkSpeed === 'fast') baseSize = Math.round(baseSize * 1.3);
    
    return baseSize;
  }, [realBandwidth.averageBitrate, networkSpeed]);

  // Retry avec backoff exponentiel
  const scheduleRetry = useCallback((retryFn: () => void) => {
    if (retryCountRef.current >= 5) {
      console.error('❌ Max retries reached');
      setErrorMessage("Impossible de charger le flux après plusieurs tentatives");
      toast.error("Échec de chargement", {
        description: "Le flux est actuellement indisponible",
        duration: 5000,
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
    
    const url = useProxyRef.current ? getProxiedUrl(streamUrl) : streamUrl;
    
    const player = mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url: url,
      cors: true,
      withCredentials: false,
    }, {
      enableWorker: true,
      enableStashBuffer: true,
      stashInitialSize: getOptimalBufferSize(),
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 20,
      autoCleanupMinBackwardDuration: 8,
      liveBufferLatencyChasing: networkSpeed === 'fast',
      liveBufferLatencyMaxLatency: 5,
      liveBufferLatencyMinRemain: 1,
      fixAudioTimestampGap: true,
      lazyLoad: false,
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
            duration: 2000,
          });
        }).catch((err) => {
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

    // Configuration ultra-optimisée pour LIVE avec zéro délai
    const hls = new Hls({
      debug: false,
      enableWorker: true,
      
      // ========== LOW LATENCY MODE ==========
      lowLatencyMode: true, // TOUJOURS activé pour live
      
      // ========== BUFFER MINIMAL ==========
      maxBufferLength: 4, // 4s max buffer (vs 30s avant) pour réduire délai
      maxMaxBufferLength: 10, // Cap absolu à 10s
      maxBufferSize: 20 * 1000 * 1000, // 20MB max
      maxBufferHole: 0.1, // Tolérance trou de 100ms seulement
      
      // ========== LIVE SYNC AGRESSIF ==========
      liveSyncDurationCount: 2, // Rester à 2 segments du live (vs 3)
      liveMaxLatencyDurationCount: 4, // Max 4 segments de retard (vs 6-10)
      liveDurationInfinity: false,
      
      // ========== BACK BUFFER MINIMAL ==========
      backBufferLength: 5, // Garder seulement 5s en arrière (vs 20s)
      
      // ========== CHARGEMENT RAPIDE ==========
      manifestLoadingTimeOut: 5000, // 5s timeout (vs 10s)
      fragLoadingTimeOut: 8000, // 8s timeout (vs 20s)
      levelLoadingTimeOut: 5000,
      manifestLoadingMaxRetry: 2, // Moins de retry, plus rapide
      levelLoadingMaxRetry: 2,
      fragLoadingMaxRetry: 3,
      
      // ========== ABR ULTRA-RÉACTIF ==========
      abrEwmaFastLive: 2, // Réaction rapide (vs 3)
      abrEwmaSlowLive: 5, // Adaptation rapide (vs 9)
      abrBandWidthFactor: 0.9, // 90% de la BP estimée
      abrBandWidthUpFactor: 0.8, // Monter facilement en qualité
      abrMaxWithRealBitrate: true, // Utiliser bitrate réel
      minAutoBitrate: 0,
      
      // ========== STALL & RETRY AGRESSIFS ==========
      maxStarvationDelay: 2, // 2s max avant action
      maxLoadingDelay: 2,
      highBufferWatchdogPeriod: 1, // Check toutes les 1s
      nudgeOffset: 0.05, // Nudge plus fin
      nudgeMaxRetry: 15, // Plus de tentatives
      
      // ========== PRÉCHARGEMENT ==========
      startLevel: -1, // Auto-start
      autoStartLoad: true,
      startPosition: -1, // Démarrer au live
      
      // ========== PERFORMANCE ==========
      maxFragLookUpTolerance: 0.1, // Tolérance recherche fragment
      progressive: true, // Lecture progressive
      
      // ========== LATENCE CHASING ==========
      // Permet de rattraper le live si on prend du retard
      maxLiveSyncPlaybackRate: 1.05, // Jouer à 105% max pour rattraper
    });

    hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      console.log('✅ HLS Manifest parsed:', data.levels.length, 'levels');
      
      const qualities: StreamQuality[] = data.levels.map((level: any, index: number) => ({
        id: `level-${index}`,
        label: `${level.height}p`,
        bandwidth: level.bitrate,
        resolution: `${level.width}x${level.height}`,
        url: '',
      }));
      
      setAvailableQualities(qualities);
      
      if (autoPlay) {
        video.play().then(() => {
          console.log('✅ HLS playback started');
          retryCountRef.current = 0;
          setErrorMessage(null);
          toast.success("✅ Lecture démarrée", {
            description: `HLS • ${networkSpeed}`,
            duration: 2000,
          });
        }).catch(err => {
          if (err.name !== 'AbortError') {
            console.error('❌ Play failed:', err);
          }
        });
      }
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
      setCurrentLevel(data.level);
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.error('🔴 HLS Fatal Error:', data.type, data.details);
        
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            scheduleRetry(() => {
              hls.startLoad();
            });
            break;
            
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
            
          default:
            cleanup();
            scheduleRetry(() => createHlsPlayer());
            break;
        }
      }
    });

    hls.loadSource(getProxiedUrl(streamUrl));
    hls.attachMedia(video);
    hlsRef.current = hls;
  }, [streamUrl, autoPlay, cleanup, scheduleRetry, networkSpeed]);

  // Init player selon le type détecté
  const initPlayer = useCallback(() => {
    cleanup();
    setIsLoading(true);
    setErrorMessage(null);
    retryCountRef.current = 0;
    useProxyRef.current = false;

    playerTypeRef.current = detectStreamType(streamUrl);
    console.log(`🎯 Detected stream type: ${playerTypeRef.current}`);

    if (playerTypeRef.current === 'hls') {
      createHlsPlayer();
    } else {
      createMpegtsPlayer();
    }
  }, [streamUrl, cleanup, createHlsPlayer, createMpegtsPlayer]);

  // Buffer health monitoring
  useEffect(() => {
    if (!videoRef.current) return;
    
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused) return;
      
      if (video.buffered.length > 0) {
        const buffered = video.buffered.end(0) - video.currentTime;
        const health = Math.min(100, Math.round((buffered / 10) * 100));
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

  // Init on mount
  useEffect(() => {
    initPlayer();
    return cleanup;
  }, [streamUrl, initPlayer, cleanup]);

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
        const qualityMap: { [key: string]: number } = {
          'low': 0,
          'medium': Math.floor(availableQualities.length / 2),
          'high': availableQualities.length - 1,
        };
        
        const targetLevel = qualityMap[newQuality] || -1;
        if (targetLevel >= 0) {
          hlsRef.current.currentLevel = targetLevel;
          toast.success(`Qualité: ${availableQualities[targetLevel]?.label}`);
        }
      }
    } else {
      toast.info(`Qualité: ${newQuality}`, {
        description: 'MPEG-TS utilise une qualité fixe',
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
      
      setShowSeekFeedback({ direction: side === 'left' ? 'backward' : 'forward', show: true });
      toast.info(side === 'left' ? '⏪ -10s' : '⏩ +10s', { duration: 1000 });
      
      setTimeout(() => setShowSeekFeedback({ direction: 'forward', show: false }), 500);
      
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

      switch(e.code) {
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

  const currentQualityLabel = playerTypeRef.current === 'hls' && currentLevel >= 0 
    ? availableQualities[currentLevel]?.label || 'Auto'
    : 'Live';

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-2xl"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && !showSettings && setShowControls(false)}
      onClick={handleVideoClick}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full"
        playsInline
        preload="auto"
      />

      {/* Quality indicator */}
      {!isLoading && !errorMessage && videoMetrics.resolution !== 'N/A' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-30">
          <QualityIndicator
            resolution={videoMetrics.resolution}
            bitrate={videoMetrics.actualBitrate}
            bufferHealth={bufferHealth}
          />
          <div className="bg-blue-500/90 backdrop-blur-xl border border-blue-400/40 rounded-full px-3 py-1.5 shadow-2xl">
            <span className="text-xs font-bold text-white">{currentQualityLabel}</span>
          </div>
          <div className="bg-green-500/90 backdrop-blur-xl border border-green-400/40 rounded-full px-3 py-1.5 shadow-2xl">
            <span className="text-xs font-bold text-white">{playerTypeRef.current.toUpperCase()}</span>
          </div>
        </div>
      )}

      {/* Stats */}
      <PlayerStats 
        videoElement={videoRef.current}
        playerType={playerTypeRef.current}
        useProxy={useProxyRef.current}
        bufferHealth={bufferHealth}
        isVisible={showStats}
        networkSpeed={networkSpeed}
        bandwidthMbps={realBandwidth.currentBitrate || 0}
        bandwidthTrend="stable"
        realBitrate={realBandwidth.currentBitrate}
        healthStatus={healthStatus}
        abrState={{
          currentQuality: currentLevel >= 0 ? availableQualities[currentLevel] : null,
          targetQuality: null,
          isAdapting: false,
          adaptationReason: `${playerTypeRef.current} native`,
        }}
      />

      {/* Settings */}
      <PlayerSettings
        playbackRate={playbackRate}
        onPlaybackRateChange={setPlaybackRate}
        quality={quality}
        onQualityChange={handleQualityChange}
        isVisible={showSettings}
        onClose={() => setShowSettings(false)}
        availableQualities={availableQualities}
      />

      {/* Seek feedback */}
      {showSeekFeedback.show && (
        <div className={`absolute top-1/2 ${showSeekFeedback.direction === 'backward' ? 'left-8' : 'right-8'} -translate-y-1/2 animate-in fade-in zoom-in duration-200`}>
          <div className="bg-black/80 backdrop-blur-xl rounded-full p-4">
            <span className="text-4xl">{showSeekFeedback.direction === 'backward' ? '⏪' : '⏩'}</span>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && !errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-40">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 animate-spin text-white" />
            <p className="text-white font-medium">Chargement du flux...</p>
            {retryCountRef.current > 0 && (
              <p className="text-white/70 text-sm">Tentative {retryCountRef.current}/5</p>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-40">
          <div className="flex flex-col items-center gap-4 max-w-md px-6">
            <div className="text-red-500 text-6xl">⚠️</div>
            <p className="text-white font-bold text-xl text-center">{errorMessage}</p>
            <Button
              onClick={() => {
                retryCountRef.current = 0;
                initPlayer();
              }}
              className="bg-primary hover:bg-primary/90"
            >
              Réessayer
            </Button>
          </div>
        </div>
      )}

      {/* Controls */}
      {showControls && !errorMessage && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 z-30">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={handlePlayPause}
              className="text-white hover:bg-white/20"
            >
              {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={handleMuteToggle}
              className="text-white hover:bg-white/20"
            >
              {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </Button>

            <Slider
              value={[isMuted ? 0 : volume]}
              onValueChange={handleVolumeChange}
              max={1}
              step={0.1}
              className="w-24"
            />

            <div className="flex-1" />

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowStats(!showStats)}
              className="text-white hover:bg-white/20"
            >
              <BarChart3 className="w-5 h-5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(!showSettings)}
              className="text-white hover:bg-white/20"
            >
              <SettingsIcon className="w-5 h-5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={handlePiP}
              className="text-white hover:bg-white/20"
            >
              <PictureInPicture className="w-5 h-5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={handleFullscreen}
              className="text-white hover:bg-white/20"
            >
              <Maximize className="w-5 h-5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
