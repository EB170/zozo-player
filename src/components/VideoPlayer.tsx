import { useEffect, useRef, useState } from "react";
import mpegts from "mpegts.js";
import Hls from "hls.js";
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";

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
  // Double video system pour transitions seamless
  const video1Ref = useRef<HTMLVideoElement>(null);
  const video2Ref = useRef<HTMLVideoElement>(null);
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
  const isInitializedRef = useRef(false);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);

  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();

  const getActiveVideo = () => {
    return activeVideoRef.current === 1 ? video1Ref.current : video2Ref.current;
  };

  const getBackupVideo = () => {
    return activeVideoRef.current === 1 ? video2Ref.current : video1Ref.current;
  };

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
      stashInitialSize: 1024, // Buffer plus grand pour 0 saccade
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 15,
      autoCleanupMinBackwardDuration: 5,
      liveBufferLatencyChasing: true, // Chasing activé pour low latency
      liveBufferLatencyMaxLatency: 3,
      liveBufferLatencyMinRemain: 0.5,
      fixAudioTimestampGap: true,
      lazyLoad: false,
    });

    player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: any) => {
      console.log(`⚠️ Error: ${errorType}`);
      
      if (!useProxyRef.current && errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
        useProxyRef.current = true;
        setTimeout(() => initDoubleBuffer(), 50);
      } else if (useProxyRef.current && errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
        playerTypeRef.current = 'hls';
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
    
    const hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 15,
      maxBufferLength: 40, // Buffer plus long
      maxBufferSize: 80 * 1000 * 1000,
      maxBufferHole: 0.3,
      highBufferWatchdogPeriod: 1,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 5,
      maxFragLookUpTolerance: 0.1,
      liveSyncDurationCount: 2, // Sync rapide
      liveMaxLatencyDurationCount: 4,
      manifestLoadingTimeOut: 8000,
      fragLoadingTimeOut: 15000,
      manifestLoadingMaxRetry: 4,
      fragLoadingMaxRetry: 8,
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
    
    if (playerTypeRef.current === 'mpegts') {
      const player = createMpegtsPlayer(videoElement);
      playerRef.current = player;
    } else {
      const hls = createHlsPlayer(videoElement);
      hlsRefObj.current = hls;
    }
  };

  const switchToBackup = () => {
    const activeVideo = getActiveVideo();
    const backupVideo = getBackupVideo();
    
    if (!activeVideo || !backupVideo) return;
    
    // Préparer le backup
    if (activeVideoRef.current === 1) {
      prepareVideo(backupVideo, mpegts2Ref, hls2Ref);
    } else {
      prepareVideo(backupVideo, mpegts1Ref, hls1Ref);
    }
    
    // Attendre que le backup soit prêt
    const checkReady = setInterval(() => {
      if (backupVideo.readyState >= 2) { // HAVE_CURRENT_DATA
        clearInterval(checkReady);
        
        // Transition fluide
        backupVideo.currentTime = activeVideo.currentTime;
        backupVideo.play().then(() => {
          // Swap instantané
          activeVideo.style.opacity = '0';
          backupVideo.style.opacity = '1';
          
          setTimeout(() => {
            activeVideo.pause();
            activeVideoRef.current = activeVideoRef.current === 1 ? 2 : 1;
          }, 50);
        });
      }
    }, 50);
    
    // Timeout de sécurité
    setTimeout(() => clearInterval(checkReady), 2000);
  };

  const initDoubleBuffer = () => {
    if (!video1Ref.current || !video2Ref.current) return;
    
    cleanup();
    setIsLoading(true);
    
    // Init video 1 (active)
    const video1 = video1Ref.current;
    video1.style.opacity = '1';
    video1.style.zIndex = '2';
    prepareVideo(video1, mpegts1Ref, hls1Ref);
    
    if (autoPlay) {
      // Démarrage INSTANTANÉ - 0 délai
      const attemptPlay = () => {
        video1.play().then(() => {
          setIsPlaying(true);
          setIsLoading(false);
          
          // Précharger video 2 en arrière-plan immédiatement
          setTimeout(() => {
            const video2 = video2Ref.current;
            if (video2) {
              video2.style.opacity = '0';
              video2.style.zIndex = '1';
              prepareVideo(video2, mpegts2Ref, hls2Ref);
            }
          }, 1000);
        }).catch(() => {
          // Retry immédiat
          setTimeout(attemptPlay, 100);
        });
      };
      
      // Démarrage immédiat
      setTimeout(attemptPlay, 0);
    }
    
    isInitializedRef.current = true;
  };

  // Monitoring ultra-rapide
  const startHealthMonitoring = () => {
    if (healthCheckRef.current) clearInterval(healthCheckRef.current);
    
    lastTimeRef.current = Date.now();
    stallCountRef.current = 0;
    
    healthCheckRef.current = setInterval(() => {
      const activeVideo = getActiveVideo();
      if (!activeVideo || activeVideo.paused) return;
      
      const now = Date.now();
      const elapsed = now - lastTimeRef.current;
      
      // Détection stall ultra-rapide (2s)
      if (elapsed > 2000) {
        stallCountRef.current++;
        console.warn(`⚠️ Stall detected (${stallCountRef.current})`);
        
        if (stallCountRef.current >= 2) {
          console.log('🔄 Switching buffer');
          stallCountRef.current = 0;
          switchToBackup();
        }
      } else {
        stallCountRef.current = 0;
      }
    }, 1000);
  };

  // Switch automatique seamless toutes les 15s
  const startAutoSwitch = () => {
    if (switchTimerRef.current) clearInterval(switchTimerRef.current);
    
    switchTimerRef.current = setInterval(() => {
      console.log('🔄 Auto switch (15s)');
      switchToBackup();
    }, 15000);
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
    isInitializedRef.current = false;
    
    initDoubleBuffer();
    startHealthMonitoring();
    startAutoSwitch();
    
    return () => cleanup();
  }, [streamUrl]);

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
    
    [video1Ref.current, video2Ref.current].forEach(video => {
      if (video) {
        video.volume = newVolume;
        if (newVolume > 0 && isMuted) {
          video.muted = false;
        }
      }
    });
    
    if (newVolume > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  const handleMuteToggle = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    
    [video1Ref.current, video2Ref.current].forEach(video => {
      if (video) {
        video.muted = newMuted;
      }
    });
  };

  const handleFullscreen = () => {
    const activeVideo = getActiveVideo();
    if (!activeVideo) return;
    if (activeVideo.requestFullscreen) {
      activeVideo.requestFullscreen();
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
    }
    hideControlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  };

  return (
    <div 
      className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-2xl"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      {/* Double video system - transitions invisibles */}
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

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <span className="text-xs text-muted-foreground">
              {playerTypeRef.current.toUpperCase()} • {useProxyRef.current ? 'Proxy' : 'Direct'}
            </span>
          </div>
        </div>
      )}

      {showControls && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4 space-y-3 z-20">
          <div className="flex items-center gap-3">
            <Button
              size="icon"
              variant="ghost"
              onClick={handlePlayPause}
              className="text-white hover:text-primary"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </Button>

            <div className="flex items-center gap-2 flex-1 max-w-xs">
              <Button
                size="icon"
                variant="ghost"
                onClick={handleMuteToggle}
                className="text-white hover:text-primary"
              >
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </Button>
              <Slider
                value={[isMuted ? 0 : volume]}
                onValueChange={handleVolumeChange}
                max={1}
                step={0.1}
                className="flex-1"
              />
            </div>

            <Button
              size="icon"
              variant="ghost"
              onClick={handleFullscreen}
              className="text-white hover:text-primary ml-auto"
            >
              <Maximize className="w-5 h-5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
