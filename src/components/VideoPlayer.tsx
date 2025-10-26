import { useEffect, useRef, useState, useCallback } from "react";
import mpegts from "mpegts.js";
import Hls from "hls.js";
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2, PictureInPicture, BarChart3, Settings as SettingsIcon } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { PlayerStats } from "./PlayerStats";
import { PlayerSettings } from "./PlayerSettings";
import { QualityIndicator } from "./QualityIndicator";
import { useBandwidthMonitor } from "@/hooks/useBandwidthMonitor";
import { useErrorRecovery } from "@/hooks/useErrorRecovery";
import { useVideoMetrics } from "@/hooks/useVideoMetrics";
import { toast } from "sonner";

interface VideoPlayerProps {
  streamUrl: string;
  autoPlay?: boolean;
}

const getProxiedUrl = (originalUrl: string): string => {
  const projectId = "wxkvljkvqcamktlwfmfx";
  const proxyUrl = `https://${projectId}.supabase.co/functions/v1/stream-proxy`;
  return `${proxyUrl}?url=${encodeURIComponent(originalUrl)}`;
};

export const VideoPlayer = ({ streamUrl, autoPlay = true }: VideoPlayerProps) => {
  // Triple video system pour seamless transitions
  const video1Ref = useRef<HTMLVideoElement>(null);
  const video2Ref = useRef<HTMLVideoElement>(null);
  const video3Ref = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeVideoRef = useRef<1 | 2 | 3>(1);
  
  const mpegts1Ref = useRef<any>(null);
  const mpegts2Ref = useRef<any>(null);
  const mpegts3Ref = useRef<any>(null);
  const hls1Ref = useRef<Hls | null>(null);
  const hls2Ref = useRef<Hls | null>(null);
  const hls3Ref = useRef<Hls | null>(null);
  
  const switchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const healthCheckRef = useRef<NodeJS.Timeout | null>(null);
  const useProxyRef = useRef(false);
  const playerTypeRef = useRef<'mpegts' | 'hls'>('mpegts');
  const lastTimeRef = useRef(0);
  const stallCountRef = useRef(0);
  const networkSpeedRef = useRef<'fast' | 'medium' | 'slow'>('fast');
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
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showSeekFeedback, setShowSeekFeedback] = useState<{direction: 'forward' | 'backward', show: boolean}>({direction: 'forward', show: false});

  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();

  // Hooks professionnels
  const bandwidthMetrics = useBandwidthMonitor();
  const errorRecovery = useErrorRecovery();
  const activeVideo = activeVideoRef.current === 1 ? video1Ref.current : activeVideoRef.current === 2 ? video2Ref.current : video3Ref.current;
  const videoMetrics = useVideoMetrics(activeVideo);

  const getActiveVideo = () => {
    if (activeVideoRef.current === 1) return video1Ref.current;
    if (activeVideoRef.current === 2) return video2Ref.current;
    return video3Ref.current;
  };

  const getNextVideo = () => {
    const next = (activeVideoRef.current % 3) + 1;
    if (next === 1) return video1Ref.current;
    if (next === 2) return video2Ref.current;
    return video3Ref.current;
  };

  const getNextPlayerRefs = () => {
    const next = (activeVideoRef.current % 3) + 1;
    if (next === 1) return { mpegts: mpegts1Ref, hls: hls1Ref };
    if (next === 2) return { mpegts: mpegts2Ref, hls: hls2Ref };
    return { mpegts: mpegts3Ref, hls: hls3Ref };
  };

  // Détection réseau adaptative
  const detectNetworkSpeed = useCallback(() => {
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    
    if (connection) {
      const effectiveType = connection.effectiveType;
      
      if (effectiveType === '4g' || effectiveType === '5g') {
        networkSpeedRef.current = 'fast';
      } else if (effectiveType === '3g') {
        networkSpeedRef.current = 'medium';
      } else {
        networkSpeedRef.current = 'slow';
      }
      
      console.log(`📶 Network: ${effectiveType} (${networkSpeedRef.current})`);
    }
  }, []);

  const cleanup = () => {
    if (switchTimerRef.current) {
      clearInterval(switchTimerRef.current);
      switchTimerRef.current = null;
    }
    
    if (healthCheckRef.current) {
      clearInterval(healthCheckRef.current);
      healthCheckRef.current = null;
    }
    
    [mpegts1Ref, mpegts2Ref, mpegts3Ref].forEach(ref => {
      if (ref.current) {
        try {
          ref.current.unload();
          ref.current.detachMediaElement();
          ref.current.destroy();
        } catch (e) {}
        ref.current = null;
      }
    });
    
    [hls1Ref, hls2Ref, hls3Ref].forEach(ref => {
      if (ref.current) {
        try {
          ref.current.destroy();
        } catch (e) {}
        ref.current = null;
      }
    });
  };

  // Adapter buffer selon bandwidth et qualité
  const getOptimalBufferSize = () => {
    const bandwidth = bandwidthMetrics.averageBandwidth || bandwidthMetrics.currentBandwidth;
    const speed = networkSpeedRef.current;
    
    let baseSize = 1024;
    
    // Adapter selon qualité demandée
    if (quality === 'high') baseSize = 1536;
    else if (quality === 'medium') baseSize = 1024;
    else if (quality === 'low') baseSize = 768;
    else {
      // Auto - adapter selon bandwidth
      if (bandwidth > 8) baseSize = 1536;
      else if (bandwidth > 4) baseSize = 1024;
      else baseSize = 768;
    }
    
    // Modifier selon vitesse réseau
    if (speed === 'slow') baseSize = Math.round(baseSize * 0.7);
    else if (speed === 'fast') baseSize = Math.round(baseSize * 1.2);
    
    return baseSize;
  };

  const createMpegtsPlayer = (videoElement: HTMLVideoElement) => {
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
      liveBufferLatencyChasing: networkSpeedRef.current === 'fast',
      liveBufferLatencyMaxLatency: 5,
      liveBufferLatencyMinRemain: 1,
      fixAudioTimestampGap: true,
      lazyLoad: false,
    });

    player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: any) => {
      errorRecovery.recordError(`MPEGTS: ${errorType}`);
      
      if (!useProxyRef.current && errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
        useProxyRef.current = true;
        toast.info("🔄 Basculement vers proxy");
        errorRecovery.attemptRecovery(() => initTripleBuffer());
      } else if (useProxyRef.current && errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
        playerTypeRef.current = 'hls';
        toast.info("🔄 Basculement vers HLS");
        errorRecovery.attemptRecovery(() => initTripleBuffer());
      }
    });

    player.attachMediaElement(videoElement);
    player.load();
    
    return player;
  };

  const createHlsPlayer = (videoElement: HTMLVideoElement) => {
    if (!Hls.isSupported()) return null;
    
    const url = getProxiedUrl(streamUrl);
    
    const bufferLength = networkSpeedRef.current === 'fast' ? 60 : networkSpeedRef.current === 'medium' ? 40 : 30;
    
    const hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: networkSpeedRef.current === 'fast',
      backBufferLength: 20,
      maxBufferLength: bufferLength,
      maxBufferSize: 120 * 1000 * 1000,
      maxBufferHole: 0.5,
      highBufferWatchdogPeriod: 2,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 8,
      maxFragLookUpTolerance: 0.2,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 6,
      manifestLoadingTimeOut: 12000,
      fragLoadingTimeOut: 25000,
      manifestLoadingMaxRetry: 6,
      fragLoadingMaxRetry: 12,
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        errorRecovery.recordError(`HLS: ${data.type} - ${data.details}`);
        
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          errorRecovery.attemptRecovery(() => {
            hls.startLoad();
          });
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          errorRecovery.attemptRecovery(() => {
            hls.recoverMediaError();
          });
        } else {
          playerTypeRef.current = 'mpegts';
          errorRecovery.attemptRecovery(() => initTripleBuffer());
        }
      }
    });

    hls.loadSource(url);
    hls.attachMedia(videoElement);
    
    return hls;
  };

  const prepareVideo = (videoElement: HTMLVideoElement, refs: { mpegts: any, hls: any }) => {
    if (!videoElement) return;
    
    videoElement.volume = volume;
    videoElement.muted = isMuted;
    videoElement.playbackRate = playbackRate;
    
    if (playerTypeRef.current === 'mpegts') {
      const player = createMpegtsPlayer(videoElement);
      refs.mpegts.current = player;
    } else {
      const hls = createHlsPlayer(videoElement);
      refs.hls.current = hls;
    }
  };

  const switchToNext = useCallback(() => {
    const activeVideo = getActiveVideo();
    const nextVideo = getNextVideo();
    
    if (!activeVideo || !nextVideo || isTransitioning) return;
    
    setIsTransitioning(true);
    console.log(`🔄 Triple buffer switch: ${activeVideoRef.current} → ${(activeVideoRef.current % 3) + 1}`);
    
    const nextRefs = getNextPlayerRefs();
    prepareVideo(nextVideo, nextRefs);
    
    const checkReady = setInterval(() => {
      if (nextVideo.readyState >= 2) {
        clearInterval(checkReady);
        
        nextVideo.currentTime = activeVideo.currentTime;
        nextVideo.playbackRate = playbackRate;
        nextVideo.play().then(() => {
          // Transition fluide
          activeVideo.style.opacity = '0';
          nextVideo.style.opacity = '1';
          nextVideo.style.zIndex = '3';
          activeVideo.style.zIndex = '1';
          
          setTimeout(() => {
            activeVideo.pause();
            activeVideoRef.current = (activeVideoRef.current % 3) + 1 as 1 | 2 | 3;
            setIsTransitioning(false);
            errorRecovery.reset(); // Reset sur succès
          }, 150);
        });
      }
    }, 50);
    
    setTimeout(() => {
      clearInterval(checkReady);
      setIsTransitioning(false);
    }, 4000);
  }, [playbackRate, isTransitioning]);

  const initTripleBuffer = () => {
    if (!video1Ref.current || !video2Ref.current || !video3Ref.current) return;
    
    cleanup();
    setIsLoading(true);
    detectNetworkSpeed();
    
    const video1 = video1Ref.current;
    video1.style.opacity = '1';
    video1.style.zIndex = '3';
    prepareVideo(video1, { mpegts: mpegts1Ref, hls: hls1Ref });
    
    if (autoPlay) {
      const attemptPlay = () => {
        video1.play().then(() => {
          setIsPlaying(true);
          setIsLoading(false);
          toast.success("✅ Lecture démarrée", {
            description: `${playerTypeRef.current.toUpperCase()} • ${networkSpeedRef.current}`,
            duration: 2000,
          });
          
          // Préparer video 2 après 2s
          setTimeout(() => {
            const video2 = video2Ref.current;
            if (video2) {
              video2.style.opacity = '0';
              video2.style.zIndex = '2';
              prepareVideo(video2, { mpegts: mpegts2Ref, hls: hls2Ref });
            }
          }, 2000);
          
          // Préparer video 3 après 4s
          setTimeout(() => {
            const video3 = video3Ref.current;
            if (video3) {
              video3.style.opacity = '0';
              video3.style.zIndex = '1';
              prepareVideo(video3, { mpegts: mpegts3Ref, hls: hls3Ref });
            }
          }, 4000);
        }).catch(() => {
          if (errorRecovery.canRetry) {
            errorRecovery.attemptRecovery(attemptPlay);
          } else {
            setIsLoading(false);
            toast.error("❌ Échec de lecture après plusieurs tentatives");
          }
        });
      };
      
      setTimeout(attemptPlay, 0);
    }
  };

  const startHealthMonitoring = useCallback(() => {
    if (healthCheckRef.current) clearInterval(healthCheckRef.current);
    
    lastTimeRef.current = Date.now();
    stallCountRef.current = 0;
    
    healthCheckRef.current = setInterval(() => {
      const activeVideo = getActiveVideo();
      if (!activeVideo || activeVideo.paused) return;
      
      const now = Date.now();
      const elapsed = now - lastTimeRef.current;
      
      // Calculer buffer health
      if (activeVideo.buffered.length > 0) {
        const buffered = activeVideo.buffered.end(0) - activeVideo.currentTime;
        const health = Math.min(100, Math.round((buffered / 6) * 100));
        setBufferHealth(health);
        
        // Alert si buffer critique
        if (health < 20 && stallCountRef.current === 0) {
          console.warn('⚠️ Buffer critique!');
          toast.warning("Buffer faible", {
            description: "Adaptation de la qualité...",
            duration: 2000,
          });
        }
      }
      
      // Détection stall avancée
      if (elapsed > 3000) {
        stallCountRef.current++;
        console.warn(`⚠️ Stall détecté (${stallCountRef.current})`);
        
        if (stallCountRef.current >= 2) {
          console.log('🔄 Auto-recovery activé');
          stallCountRef.current = 0;
          switchToNext();
        }
      } else {
        stallCountRef.current = 0;
      }
    }, 1000);
  }, [switchToNext]);

  const startAutoSwitch = useCallback(() => {
    if (switchTimerRef.current) clearInterval(switchTimerRef.current);
    
    // Adapter intervalle selon qualité réseau
    const bandwidth = bandwidthMetrics.averageBandwidth || bandwidthMetrics.currentBandwidth;
    let interval = 15000;
    
    if (bandwidth > 10) interval = 10000; // Connexion excellente
    else if (bandwidth > 5) interval = 15000; // Bonne connexion
    else if (bandwidth > 2) interval = 20000; // Connexion moyenne
    else interval = 30000; // Connexion faible
    
    switchTimerRef.current = setInterval(() => {
      if (!isTransitioning) {
        console.log(`🔄 Auto switch planifié (${interval/1000}s)`);
        switchToNext();
      }
    }, interval);
  }, [switchToNext, isTransitioning, bandwidthMetrics]);

  // Double-tap seek pour mobile
  const handleVideoClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeVideo) return;
    
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const side = clickX < rect.width / 2 ? 'left' : 'right';
    
    // Double-tap détecté (moins de 300ms)
    if (now - lastTapTimeRef.current < 300 && lastTapSideRef.current === side) {
      const seekAmount = side === 'left' ? -10 : 10;
      activeVideo.currentTime = Math.max(0, activeVideo.currentTime + seekAmount);
      
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

  // Raccourcis clavier avancés
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const activeVideo = getActiveVideo();
      if (!activeVideo) return;

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
          toast.info(`🔊 Volume: ${Math.round((volume + 0.1) * 100)}%`, { duration: 1000 });
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(v => Math.max(0, v - 0.1));
          toast.info(`🔉 Volume: ${Math.round((volume - 0.1) * 100)}%`, { duration: 1000 });
          break;
        case 'ArrowLeft':
          e.preventDefault();
          activeVideo.currentTime = Math.max(0, activeVideo.currentTime - 10);
          toast.info('⏪ -10s', { duration: 1000 });
          break;
        case 'ArrowRight':
          e.preventDefault();
          activeVideo.currentTime = activeVideo.currentTime + 10;
          toast.info('⏩ +10s', { duration: 1000 });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isPlaying, volume]);

  useEffect(() => {
    const video1 = video1Ref.current;
    const video2 = video2Ref.current;
    const video3 = video3Ref.current;
    
    if (!video1 || !video2 || !video3) return;

    const handleTimeUpdate = () => {
      lastTimeRef.current = Date.now();
    };

    const handlePlaying = () => {
      setIsPlaying(true);
      setIsLoading(false);
    };

    const handleWaiting = () => {
      setIsLoading(true);
    };

    [video1, video2, video3].forEach(video => {
      video.addEventListener('timeupdate', handleTimeUpdate);
      video.addEventListener('playing', handlePlaying);
      video.addEventListener('waiting', handleWaiting);
    });

    return () => {
      [video1, video2, video3].forEach(video => {
        video.removeEventListener('timeupdate', handleTimeUpdate);
        video.removeEventListener('playing', handlePlaying);
        video.removeEventListener('waiting', handleWaiting);
      });
    };
  }, []);

  useEffect(() => {
    if (!streamUrl) return;
    
    useProxyRef.current = false;
    playerTypeRef.current = 'mpegts';
    activeVideoRef.current = 1;
    
    initTripleBuffer();
    startHealthMonitoring();
    startAutoSwitch();
    
    return () => cleanup();
  }, [streamUrl, quality]);

  useEffect(() => {
    [video1Ref.current, video2Ref.current, video3Ref.current].forEach(video => {
      if (video) {
        video.volume = volume;
      }
    });
  }, [volume]);

  useEffect(() => {
    [video1Ref.current, video2Ref.current, video3Ref.current].forEach(video => {
      if (video) {
        video.playbackRate = playbackRate;
      }
    });
  }, [playbackRate]);

  const handlePlayPause = () => {
    const activeVideo = getActiveVideo();
    if (!activeVideo) return;
    
    if (isPlaying) {
      activeVideo.pause();
      setIsPlaying(false);
    } else {
      activeVideo.play();
      setIsPlaying(true);
    }
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    
    if (newVolume > 0 && isMuted) {
      setIsMuted(false);
      [video1Ref.current, video2Ref.current, video3Ref.current].forEach(video => {
        if (video) video.muted = false;
      });
    }
  };

  const handleMuteToggle = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    
    [video1Ref.current, video2Ref.current, video3Ref.current].forEach(video => {
      if (video) video.muted = newMuted;
    });
  };

  const handleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  };

  const handlePiP = async () => {
    const activeVideo = getActiveVideo();
    if (!activeVideo) return;
    
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await activeVideo.requestPictureInPicture();
        toast.success("📺 Picture-in-Picture activé");
      }
    } catch (err) {
      toast.error("Picture-in-Picture non disponible");
    }
  };

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

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-2xl"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && !showSettings && setShowControls(false)}
      onClick={handleVideoClick}
    >
      {/* Triple video system */}
      <video
        ref={video1Ref}
        className="absolute inset-0 w-full h-full transition-opacity duration-300"
        style={{ opacity: 0, zIndex: 1 }}
        playsInline
        preload="auto"
      />
      
      <video
        ref={video2Ref}
        className="absolute inset-0 w-full h-full transition-opacity duration-300"
        style={{ opacity: 0, zIndex: 1 }}
        playsInline
        preload="auto"
      />
      
      <video
        ref={video3Ref}
        className="absolute inset-0 w-full h-full transition-opacity duration-300"
        style={{ opacity: 0, zIndex: 1 }}
        playsInline
        preload="auto"
      />

      {/* Quality indicator */}
      {!isLoading && videoMetrics.resolution !== 'N/A' && (
        <QualityIndicator
          resolution={videoMetrics.resolution}
          bitrate={videoMetrics.actualBitrate}
          bufferHealth={bufferHealth}
        />
      )}

      {/* Stats overlay */}
      <PlayerStats 
        videoElement={getActiveVideo()}
        playerType={playerTypeRef.current}
        useProxy={useProxyRef.current}
        bufferHealth={bufferHealth}
        isVisible={showStats}
        networkSpeed={networkSpeedRef.current}
        bandwidthMbps={bandwidthMetrics.currentBandwidth}
        bandwidthTrend={bandwidthMetrics.trend}
      />

      {/* Settings overlay */}
      <PlayerSettings
        playbackRate={playbackRate}
        onPlaybackRateChange={setPlaybackRate}
        quality={quality}
        onQualityChange={setQuality}
        isVisible={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {/* Seek feedback animation */}
      {showSeekFeedback.show && (
        <div className={`absolute top-1/2 ${showSeekFeedback.direction === 'backward' ? 'left-8' : 'right-8'} -translate-y-1/2 animate-in fade-in zoom-in duration-200`}>
          <div className="bg-black/80 backdrop-blur-xl rounded-full p-4">
            <span className="text-4xl">{showSeekFeedback.direction === 'backward' ? '⏪' : '⏩'}</span>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/95 backdrop-blur-sm z-10 animate-in fade-in duration-300">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <Loader2 className="w-16 h-16 text-primary animate-spin" />
              <div className="absolute inset-0 w-16 h-16 rounded-full bg-primary/20 animate-ping" />
            </div>
            <div className="text-center space-y-2">
              <div className="text-base text-white font-bold">
                {errorRecovery.errorState.isRecovering ? '🔄 Récupération en cours...' : 'Chargement du flux...'}
              </div>
              <div className="text-xs text-white/70 font-mono space-y-1">
                <div>{playerTypeRef.current.toUpperCase()} • {useProxyRef.current ? '🔒 Proxy' : '⚡ Direct'}</div>
                <div>📶 {networkSpeedRef.current === 'fast' ? '5G' : networkSpeedRef.current === 'medium' ? '4G' : '3G'} • {bandwidthMetrics.currentBandwidth.toFixed(1)} Mb/s</div>
                {errorRecovery.errorState.errorCount > 0 && (
                  <div className="text-yellow-400">
                    Tentative {errorRecovery.errorState.errorCount}/5
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showControls && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/85 to-transparent p-4 md:p-6 space-y-3 z-20 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Buffer health bar avec gradient */}
          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden shadow-lg">
            <div 
              className={`h-full transition-all duration-500 ease-out ${
                bufferHealth > 70 ? 'bg-gradient-to-r from-green-500 to-green-400' :
                bufferHealth > 40 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' :
                'bg-gradient-to-r from-red-500 to-red-400'
              }`}
              style={{ width: `${bufferHealth}%` }}
            />
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            {/* Play/Pause */}
            <Button
              size="icon"
              variant="ghost"
              onClick={handlePlayPause}
              className="text-white hover:text-primary hover:bg-white/10 transition-all h-11 w-11 md:h-10 md:w-10"
            >
              {isPlaying ? <Pause className="w-6 h-6 md:w-5 md:h-5" /> : <Play className="w-6 h-6 md:w-5 md:h-5" />}
            </Button>

            {/* Volume controls */}
            <div className="flex items-center gap-2 flex-1 max-w-xs">
              <Button
                size="icon"
                variant="ghost"
                onClick={handleMuteToggle}
                className="text-white hover:text-primary hover:bg-white/10 transition-all h-11 w-11 md:h-10 md:w-10"
              >
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </Button>
              <Slider
                value={[isMuted ? 0 : volume]}
                onValueChange={handleVolumeChange}
                max={1}
                step={0.05}
                className="flex-1 cursor-pointer"
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 md:gap-2 ml-auto">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowSettings(!showSettings)}
                className={`text-white hover:text-primary hover:bg-white/10 transition-all h-11 w-11 md:h-10 md:w-10 ${showSettings ? 'bg-white/10 text-primary' : ''}`}
                title="Paramètres (raccourci: S)"
              >
                <SettingsIcon className="w-5 h-5" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowStats(!showStats)}
                className={`hidden md:flex text-white hover:text-primary hover:bg-white/10 transition-all h-10 w-10 ${showStats ? 'bg-white/10 text-primary' : ''}`}
                title="Analytics Pro"
              >
                <BarChart3 className="w-5 h-5" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={handlePiP}
                className="hidden md:flex text-white hover:text-primary hover:bg-white/10 transition-all h-10 w-10"
                title="Picture-in-Picture (P)"
              >
                <PictureInPicture className="w-5 h-5" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={handleFullscreen}
                className="text-white hover:text-primary hover:bg-white/10 transition-all h-11 w-11 md:h-10 md:w-10"
                title="Plein écran (F)"
              >
                <Maximize className="w-5 h-5" />
              </Button>
            </div>
          </div>
          
          {/* Indicateur vitesse si != 1x */}
          {playbackRate !== 1 && (
            <div className="absolute top-3 right-4 bg-primary text-primary-foreground px-3 py-1.5 rounded-full text-xs font-bold shadow-lg animate-in fade-in slide-in-from-right-2">
              {playbackRate}x
            </div>
          )}
        </div>
      )}
    </div>
  );
};
