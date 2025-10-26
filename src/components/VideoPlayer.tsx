import { useEffect, useRef, useState, useCallback } from "react";
import mpegts from "mpegts.js";
import Hls from "hls.js";
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2, PictureInPicture, BarChart3, Settings as SettingsIcon } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { PlayerStats } from "./PlayerStats";
import { PlayerSettings } from "./PlayerSettings";
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
  // Double video system
  const video1Ref = useRef<HTMLVideoElement>(null);
  const video2Ref = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeVideoRef = useRef<1 | 2>(1);
  
  const mpegts1Ref = useRef<any>(null);
  const mpegts2Ref = useRef<any>(null);
  const hls1Ref = useRef<Hls | null>(null);
  const hls2Ref = useRef<Hls | null>(null);
  
  const switchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const healthCheckRef = useRef<NodeJS.Timeout | null>(null);
  const useProxyRef = useRef(false);
  const playerTypeRef = useRef<'mpegts' | 'hls'>('mpegts');
  const lastTimeRef = useRef(0);
  const stallCountRef = useRef(0);
  const networkSpeedRef = useRef<'fast' | 'medium' | 'slow'>('fast');
  
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
  const [touchStartX, setTouchStartX] = useState(0);
  const [touchStartY, setTouchStartY] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();

  const getActiveVideo = () => {
    return activeVideoRef.current === 1 ? video1Ref.current : video2Ref.current;
  };

  const getBackupVideo = () => {
    return activeVideoRef.current === 1 ? video2Ref.current : video1Ref.current;
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
    
    [mpegts1Ref, mpegts2Ref].forEach(ref => {
      if (ref.current) {
        try {
          ref.current.unload();
          ref.current.detachMediaElement();
          ref.current.destroy();
        } catch (e) {}
        ref.current = null;
      }
    });
    
    [hls1Ref, hls2Ref].forEach(ref => {
      if (ref.current) {
        try {
          ref.current.destroy();
        } catch (e) {}
        ref.current = null;
      }
    });
  };

  const getBufferSize = () => {
    const speed = networkSpeedRef.current;
    const qualityMultiplier = quality === 'low' ? 0.7 : quality === 'medium' ? 1 : quality === 'high' ? 1.5 : 1;
    
    if (speed === 'fast') return Math.round(1536 * qualityMultiplier);
    if (speed === 'medium') return Math.round(1024 * qualityMultiplier);
    return Math.round(768 * qualityMultiplier);
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
      stashInitialSize: getBufferSize(),
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 18,
      autoCleanupMinBackwardDuration: 6,
      liveBufferLatencyChasing: networkSpeedRef.current === 'fast',
      liveBufferLatencyMaxLatency: 4,
      liveBufferLatencyMinRemain: 0.5,
      fixAudioTimestampGap: true,
      lazyLoad: false,
    });

    player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: any) => {
      console.log(`⚠️ Error: ${errorType}`);
      
      if (!useProxyRef.current && errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
        useProxyRef.current = true;
        toast.info("Basculement vers proxy");
        setTimeout(() => initDoubleBuffer(), 50);
      } else if (useProxyRef.current && errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
        playerTypeRef.current = 'hls';
        toast.info("Basculement vers HLS");
        setTimeout(() => initDoubleBuffer(), 50);
      }
    });

    player.attachMediaElement(videoElement);
    player.load();
    
    return player;
  };

  const createHlsPlayer = (videoElement: HTMLVideoElement) => {
    if (!Hls.isSupported()) return null;
    
    const url = getProxiedUrl(streamUrl);
    
    const bufferLength = networkSpeedRef.current === 'fast' ? 50 : networkSpeedRef.current === 'medium' ? 35 : 25;
    
    const hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: networkSpeedRef.current === 'fast',
      backBufferLength: 18,
      maxBufferLength: bufferLength,
      maxBufferSize: 100 * 1000 * 1000,
      maxBufferHole: 0.3,
      highBufferWatchdogPeriod: 1,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 5,
      maxFragLookUpTolerance: 0.1,
      liveSyncDurationCount: 2,
      liveMaxLatencyDurationCount: 5,
      manifestLoadingTimeOut: 10000,
      fragLoadingTimeOut: 20000,
      manifestLoadingMaxRetry: 5,
      fragLoadingMaxRetry: 10,
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          playerTypeRef.current = 'mpegts';
          setTimeout(() => initDoubleBuffer(), 50);
        }
      }
    });

    hls.loadSource(url);
    hls.attachMedia(videoElement);
    
    return hls;
  };

  const prepareVideo = (videoElement: HTMLVideoElement, playerRef: any, hlsRefObj: any) => {
    if (!videoElement) return;
    
    videoElement.volume = volume;
    videoElement.muted = isMuted;
    videoElement.playbackRate = playbackRate;
    
    if (playerTypeRef.current === 'mpegts') {
      const player = createMpegtsPlayer(videoElement);
      playerRef.current = player;
    } else {
      const hls = createHlsPlayer(videoElement);
      hlsRefObj.current = hls;
    }
  };

  const switchToBackup = useCallback(() => {
    const activeVideo = getActiveVideo();
    const backupVideo = getBackupVideo();
    
    if (!activeVideo || !backupVideo || isTransitioning) return;
    
    setIsTransitioning(true);
    console.log('🔄 Seamless switch');
    
    if (activeVideoRef.current === 1) {
      prepareVideo(backupVideo, mpegts2Ref, hls2Ref);
    } else {
      prepareVideo(backupVideo, mpegts1Ref, hls1Ref);
    }
    
    const checkReady = setInterval(() => {
      if (backupVideo.readyState >= 2) {
        clearInterval(checkReady);
        
        backupVideo.currentTime = activeVideo.currentTime;
        backupVideo.playbackRate = playbackRate;
        backupVideo.play().then(() => {
          activeVideo.style.opacity = '0';
          backupVideo.style.opacity = '1';
          backupVideo.style.zIndex = '2';
          activeVideo.style.zIndex = '1';
          
          setTimeout(() => {
            activeVideo.pause();
            activeVideoRef.current = activeVideoRef.current === 1 ? 2 : 1;
            setIsTransitioning(false);
          }, 100);
        });
      }
    }, 50);
    
    setTimeout(() => {
      clearInterval(checkReady);
      setIsTransitioning(false);
    }, 3000);
  }, [playbackRate, isTransitioning]);

  const initDoubleBuffer = () => {
    if (!video1Ref.current || !video2Ref.current) return;
    
    cleanup();
    setIsLoading(true);
    detectNetworkSpeed();
    
    const video1 = video1Ref.current;
    video1.style.opacity = '1';
    video1.style.zIndex = '2';
    prepareVideo(video1, mpegts1Ref, hls1Ref);
    
    if (autoPlay) {
      const attemptPlay = () => {
        video1.play().then(() => {
          setIsPlaying(true);
          setIsLoading(false);
          toast.success("Lecture démarrée");
          
          setTimeout(() => {
            const video2 = video2Ref.current;
            if (video2) {
              video2.style.opacity = '0';
              video2.style.zIndex = '1';
              prepareVideo(video2, mpegts2Ref, hls2Ref);
            }
          }, 1500);
        }).catch(() => {
          setTimeout(attemptPlay, 100);
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
        const health = Math.min(100, Math.round((buffered / 5) * 100));
        setBufferHealth(health);
      }
      
      // Détection stall
      if (elapsed > 2500) {
        stallCountRef.current++;
        console.warn(`⚠️ Stall (${stallCountRef.current})`);
        
        if (stallCountRef.current >= 2) {
          console.log('🔄 Auto-recovery');
          stallCountRef.current = 0;
          switchToBackup();
        }
      } else {
        stallCountRef.current = 0;
      }
    }, 1000);
  }, [switchToBackup]);

  const startAutoSwitch = useCallback(() => {
    if (switchTimerRef.current) clearInterval(switchTimerRef.current);
    
    const interval = networkSpeedRef.current === 'fast' ? 12000 : networkSpeedRef.current === 'medium' ? 18000 : 25000;
    
    switchTimerRef.current = setInterval(() => {
      console.log(`🔄 Auto switch (${interval/1000}s)`);
      switchToBackup();
    }, interval);
  }, [switchToBackup]);

  // Raccourcis clavier
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
        case 'ArrowUp':
          e.preventDefault();
          setVolume(v => Math.min(1, v + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(v => Math.max(0, v - 0.1));
          break;
        case 'KeyS':
          setShowStats(s => !s);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isPlaying, volume]);

  // Gesture controls mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
    setTouchStartY(e.touches[0].clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    
    // Swipe vertical = volume
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 50) {
      const volumeChange = -deltaY / 200;
      setVolume(v => Math.max(0, Math.min(1, v + volumeChange)));
    }
    
    // Swipe horizontal = seek (pas applicable pour live)
  };

  useEffect(() => {
    const video1 = video1Ref.current;
    const video2 = video2Ref.current;
    
    if (!video1 || !video2) return;

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

    video1.addEventListener('timeupdate', handleTimeUpdate);
    video2.addEventListener('timeupdate', handleTimeUpdate);
    video1.addEventListener('playing', handlePlaying);
    video2.addEventListener('playing', handlePlaying);
    video1.addEventListener('waiting', handleWaiting);
    video2.addEventListener('waiting', handleWaiting);

    return () => {
      video1.removeEventListener('timeupdate', handleTimeUpdate);
      video2.removeEventListener('timeupdate', handleTimeUpdate);
      video1.removeEventListener('playing', handlePlaying);
      video2.removeEventListener('playing', handlePlaying);
      video1.removeEventListener('waiting', handleWaiting);
      video2.removeEventListener('waiting', handleWaiting);
    };
  }, []);

  useEffect(() => {
    if (!streamUrl) return;
    
    useProxyRef.current = false;
    playerTypeRef.current = 'mpegts';
    activeVideoRef.current = 1;
    
    initDoubleBuffer();
    startHealthMonitoring();
    startAutoSwitch();
    
    return () => cleanup();
  }, [streamUrl, quality]);

  useEffect(() => {
    [video1Ref.current, video2Ref.current].forEach(video => {
      if (video) {
        video.volume = volume;
      }
    });
  }, [volume]);

  useEffect(() => {
    [video1Ref.current, video2Ref.current].forEach(video => {
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
      [video1Ref.current, video2Ref.current].forEach(video => {
        if (video) video.muted = false;
      });
    }
  };

  const handleMuteToggle = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    
    [video1Ref.current, video2Ref.current].forEach(video => {
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
        toast.success("Mode Picture-in-Picture activé");
      }
    } catch (err) {
      toast.error("Picture-in-Picture non supporté");
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
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
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

      {/* Stats overlay */}
      <PlayerStats 
        videoElement={getActiveVideo()}
        playerType={playerTypeRef.current}
        useProxy={useProxyRef.current}
        bufferHealth={bufferHealth}
        isVisible={showStats}
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

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-sm z-10 animate-in fade-in duration-300">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <Loader2 className="w-14 h-14 text-primary animate-spin" />
              <div className="absolute inset-0 w-14 h-14 rounded-full bg-primary/20 animate-ping" />
            </div>
            <div className="text-center space-y-1">
              <div className="text-sm text-white font-semibold">
                Chargement du flux...
              </div>
              <div className="text-xs text-white/60 font-mono">
                {playerTypeRef.current.toUpperCase()} • {useProxyRef.current ? '🔒 Proxy' : '⚡ Direct'} • {networkSpeedRef.current === 'fast' ? '📶 5G' : networkSpeedRef.current === 'medium' ? '📶 4G' : '📶 3G'}
              </div>
            </div>
          </div>
        </div>
      )}

      {showControls && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/85 to-transparent p-4 md:p-6 space-y-3 z-20 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Buffer health bar avec gradient */}
          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden shadow-lg">
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
            {/* Play/Pause - Plus gros sur mobile */}
            <Button
              size="icon"
              variant="ghost"
              onClick={handlePlayPause}
              className="text-white hover:text-primary hover:bg-white/10 transition-all h-10 w-10 md:h-9 md:w-9"
            >
              {isPlaying ? <Pause className="w-5 h-5 md:w-5 md:h-5" /> : <Play className="w-5 h-5 md:w-5 md:h-5" />}
            </Button>

            {/* Volume controls */}
            <div className="flex items-center gap-2 flex-1 max-w-xs">
              <Button
                size="icon"
                variant="ghost"
                onClick={handleMuteToggle}
                className="text-white hover:text-primary hover:bg-white/10 transition-all h-10 w-10 md:h-9 md:w-9"
              >
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </Button>
              <Slider
                value={[isMuted ? 0 : volume]}
                onValueChange={handleVolumeChange}
                max={1}
                step={0.1}
                className="flex-1 cursor-pointer"
              />
            </div>

            {/* Action buttons - Plus espacés */}
            <div className="flex items-center gap-1 md:gap-2 ml-auto">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowSettings(!showSettings)}
                className={`text-white hover:text-primary hover:bg-white/10 transition-all h-10 w-10 md:h-9 md:w-9 ${showSettings ? 'bg-white/10 text-primary' : ''}`}
                title="Paramètres"
              >
                <SettingsIcon className="w-5 h-5" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowStats(!showStats)}
                className={`hidden md:flex text-white hover:text-primary hover:bg-white/10 transition-all h-9 w-9 ${showStats ? 'bg-white/10 text-primary' : ''}`}
                title="Stats"
              >
                <BarChart3 className="w-5 h-5" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={handlePiP}
                className="hidden md:flex text-white hover:text-primary hover:bg-white/10 transition-all h-9 w-9"
                title="Picture-in-Picture"
              >
                <PictureInPicture className="w-5 h-5" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={handleFullscreen}
                className="text-white hover:text-primary hover:bg-white/10 transition-all h-10 w-10 md:h-9 md:w-9"
                title="Plein écran"
              >
                <Maximize className="w-5 h-5" />
              </Button>
            </div>
          </div>
          
          {/* Indicateur vitesse de lecture si différent de 1x */}
          {playbackRate !== 1 && (
            <div className="absolute top-2 right-4 bg-primary/90 text-primary-foreground px-2 py-1 rounded-md text-xs font-bold animate-in fade-in slide-in-from-right-2">
              {playbackRate}x
            </div>
          )}
        </div>
      )}
    </div>
  );
};
