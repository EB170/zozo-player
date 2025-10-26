import { useEffect, useRef, useState, useCallback } from "react";
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

const getProxiedUrl = (originalUrl: string): string => {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || "wxkvljkvqcamktlwfmfx";
  const proxyUrl = `https://${projectId}.supabase.co/functions/v1/stream-proxy`;
  return `${proxyUrl}?url=${encodeURIComponent(originalUrl)}`;
};

export const VideoPlayerOptimized = ({ streamUrl, autoPlay = true }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryCountRef = useRef(0);
  const lastTapTimeRef = useRef(0);
  const lastTapSideRef = useRef<'left' | 'right' | null>(null);
  
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

  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();

  const videoMetrics = useVideoMetrics(videoRef.current);
  const realBandwidth = useRealBandwidth();
  const { health: healthStatus } = useHealthMonitor(videoRef.current);

  // Détection réseau
  const getNetworkInfo = useCallback(() => {
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (connection) {
      const effectiveType = connection.effectiveType;
      const downlink = connection.downlink || 10;
      return { effectiveType, downlink };
    }
    return { effectiveType: '4g', downlink: 10 };
  }, []);

  // Configuration HLS optimale selon le réseau
  const getHlsConfig = useCallback(() => {
    const network = getNetworkInfo();
    const isGoodNetwork = network.effectiveType === '4g' || network.effectiveType === '5g';
    const downlink = network.downlink;

    return {
      debug: false,
      enableWorker: true,
      lowLatencyMode: isGoodNetwork,
      backBufferLength: 20,
      maxBufferLength: isGoodNetwork ? 30 : 20,
      maxBufferSize: 60 * 1000 * 1000,
      maxBufferHole: 0.5,
      highBufferWatchdogPeriod: 2,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 10,
      maxFragLookUpTolerance: 0.25,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: isGoodNetwork ? 10 : 6,
      manifestLoadingTimeOut: 10000,
      fragLoadingTimeOut: 20000,
      levelLoadingTimeOut: 10000,
      manifestLoadingMaxRetry: 4,
      levelLoadingMaxRetry: 4,
      fragLoadingMaxRetry: 6,
      startLevel: -1, // Auto
      autoStartLoad: true,
      startPosition: -1,
      capLevelOnFPSDrop: false,
      capLevelToPlayerSize: false,
      maxMaxBufferLength: 600,
      abrEwmaFastLive: 3,
      abrEwmaSlowLive: 9,
      abrEwmaFastVoD: 3,
      abrEwmaSlowVoD: 9,
      abrEwmaDefaultEstimate: downlink * 1000000,
      abrBandWidthFactor: 0.95,
      abrBandWidthUpFactor: 0.7,
      abrMaxWithRealBitrate: false,
      maxStarvationDelay: 4,
      maxLoadingDelay: 4,
      minAutoBitrate: 0,
    };
  }, [getNetworkInfo]);

  // Cleanup
  const cleanup = useCallback(() => {
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch (e) {
        console.warn('HLS cleanup error:', e);
      }
      hlsRef.current = null;
    }
  }, []);

  // Initialisation HLS optimisée
  const initPlayer = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    cleanup();
    setIsLoading(true);

    if (!Hls.isSupported()) {
      toast.error("HLS non supporté par ce navigateur");
      return;
    }

    const hls = new Hls(getHlsConfig());
    hlsRef.current = hls;

    // Événements HLS essentiels
    hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      console.log('✅ Manifest loaded:', data.levels.length, 'qualities');
      
      const qualities: StreamQuality[] = data.levels.map((level: any, index: number) => ({
        id: `level-${index}`,
        label: `${level.height}p`,
        bandwidth: level.bitrate,
        resolution: `${level.width}x${level.height}`,
        url: '', // HLS gère les URLs
        index: index,
      }));
      
      setAvailableQualities(qualities);
      
      if (autoPlay) {
        video.play().catch(err => {
          if (err.name !== 'AbortError') {
            console.error('Autoplay failed:', err);
          }
        });
      }
    });

    hls.on(Hls.Events.LEVEL_SWITCHING, (event, data) => {
      setCurrentLevel(data.level);
      const quality = availableQualities[data.level];
      if (import.meta.env.DEV && quality) {
        console.log(`🔄 Switching to: ${quality.label}`);
      }
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
      setCurrentLevel(data.level);
      if (import.meta.env.DEV) {
        console.log(`✅ Switched to level: ${data.level}`);
      }
    });

    hls.on(Hls.Events.FRAG_BUFFERED, (event, data) => {
      // Fragment chargé - bon signe
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.error('🔴 HLS Fatal Error:', data.type, data.details);
        
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (retryCountRef.current < 3) {
              console.log('🔄 Network error - retrying...');
              retryCountRef.current++;
              setTimeout(() => {
                hls.startLoad();
              }, 1000 * retryCountRef.current);
            } else {
              toast.error("Erreur réseau - impossible de charger le flux");
            }
            break;
            
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('🔄 Media error - attempting recovery...');
            hls.recoverMediaError();
            break;
            
          default:
            console.error('❌ Unrecoverable error');
            cleanup();
            toast.error("Erreur de lecture");
            break;
        }
      } else {
        // Erreur non-fatale - HLS gère
        if (import.meta.env.DEV) {
          console.warn('⚠️ HLS warning:', data.details);
        }
      }
    });

    // Charger le stream
    hls.loadSource(getProxiedUrl(streamUrl));
    hls.attachMedia(video);

    // Parser manifest pour récupérer les URLs des qualités
    parseHLSManifest(streamUrl).then(qualities => {
      if (qualities.length > 0) {
        console.log('📺 Available qualities:', qualities.map(q => q.label).join(', '));
      }
    });

  }, [streamUrl, autoPlay, getHlsConfig, cleanup, availableQualities]);

  // Gestion de la qualité manuelle
  const handleQualityChange = useCallback((newQuality: string) => {
    setQuality(newQuality);
    
    if (!hlsRef.current) return;
    
    if (newQuality === 'auto') {
      hlsRef.current.currentLevel = -1; // Auto ABR
      toast.info('Qualité automatique activée');
    } else {
      // Mapper les qualités
      const qualityMap: { [key: string]: number } = {
        'low': Math.floor(availableQualities.length * 0.33),
        'medium': Math.floor(availableQualities.length * 0.66),
        'high': availableQualities.length - 1,
      };
      
      const targetLevel = qualityMap[newQuality] || -1;
      if (targetLevel >= 0 && targetLevel < availableQualities.length) {
        hlsRef.current.currentLevel = targetLevel;
        toast.success(`Qualité: ${availableQualities[targetLevel]?.label || newQuality}`);
      }
    }
  }, [availableQualities]);

  // Calcul buffer health
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

  // Events vidéo
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
    };

    const handlePause = () => setIsPlaying(false);
    const handleWaiting = () => setIsLoading(true);
    const handlePlaying = () => {
      setIsLoading(false);
      retryCountRef.current = 0;
    };
    const handleCanPlay = () => setIsLoading(false);

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('canplay', handleCanPlay);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('canplay', handleCanPlay);
    };
  }, []);

  // Init player
  useEffect(() => {
    initPlayer();
    return cleanup;
  }, [streamUrl, initPlayer, cleanup]);

  // Volume sync
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  // Playback rate
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

  // Keyboard shortcuts
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

  const currentQualityLabel = currentLevel >= 0 && currentLevel < availableQualities.length 
    ? availableQualities[currentLevel]?.label 
    : 'Auto';

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-2xl"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && !showSettings && setShowControls(false)}
      onClick={handleVideoClick}
    >
      {/* Single video element - HLS gère tout */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full"
        playsInline
        preload="auto"
      />

      {/* Quality indicator */}
      {!isLoading && videoMetrics.resolution !== 'N/A' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-30">
          <QualityIndicator
            resolution={videoMetrics.resolution}
            bitrate={videoMetrics.actualBitrate}
            bufferHealth={bufferHealth}
          />
          <div className="bg-blue-500/90 backdrop-blur-xl border border-blue-400/40 rounded-full px-3 py-1.5 shadow-2xl">
            <span className="text-xs font-bold text-white">{currentQualityLabel}</span>
          </div>
        </div>
      )}

      {/* Stats overlay */}
      <PlayerStats 
        videoElement={videoRef.current}
        playerType="hls"
        useProxy={true}
        bufferHealth={bufferHealth}
        isVisible={showStats}
        networkSpeed="fast"
        bandwidthMbps={realBandwidth.currentBitrate || 0}
        bandwidthTrend="stable"
        realBitrate={realBandwidth.currentBitrate}
        healthStatus={healthStatus}
        abrState={{
          currentQuality: currentLevel >= 0 ? availableQualities[currentLevel] : null,
          targetQuality: null,
          isAdapting: false,
          adaptationReason: 'HLS native ABR',
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

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-40">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 animate-spin text-white" />
            <p className="text-white font-medium">Chargement du flux...</p>
          </div>
        </div>
      )}

      {/* Controls */}
      {showControls && (
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
