import { useEffect, useRef, useState } from "react";
import mpegts from "mpegts.js";
import Hls from "hls.js";
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2, AlertCircle } from "lucide-react";
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const mpegtsRef = useRef<any>(null);
  const hlsRef = useRef<Hls | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const healthCheckRef = useRef<NodeJS.Timeout | null>(null);
  const useProxyRef = useRef(false);
  const lastTimeUpdateRef = useRef(0);
  const frozenCountRef = useRef(0);
  const currentPlayerTypeRef = useRef<'mpegts' | 'hls' | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();

  const cleanup = () => {
    if (reconnectTimerRef.current) {
      clearInterval(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    
    if (healthCheckRef.current) {
      clearInterval(healthCheckRef.current);
      healthCheckRef.current = null;
    }
    
    if (mpegtsRef.current) {
      try {
        mpegtsRef.current.unload();
        mpegtsRef.current.detachMediaElement();
        mpegtsRef.current.destroy();
      } catch (e) {
        console.log('MPEGTS cleanup error:', e);
      }
      mpegtsRef.current = null;
    }
    
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch (e) {
        console.log('HLS cleanup error:', e);
      }
      hlsRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
  };

  // Système de monitoring de santé du flux
  const startHealthMonitoring = () => {
    if (healthCheckRef.current) {
      clearInterval(healthCheckRef.current);
    }
    
    lastTimeUpdateRef.current = Date.now();
    frozenCountRef.current = 0;

    healthCheckRef.current = setInterval(() => {
      if (!videoRef.current) return;
      
      const video = videoRef.current;
      const now = Date.now();
      const timeSinceLastUpdate = now - lastTimeUpdateRef.current;
      
      // Si le flux est gelé pendant plus de 5 secondes
      if (!video.paused && timeSinceLastUpdate > 5000) {
        frozenCountRef.current++;
        console.warn(`⚠️ Stream frozen detected (${frozenCountRef.current})`);
        
        if (frozenCountRef.current >= 2) {
          console.log('🔄 Forcing reconnect due to frozen stream');
          frozenCountRef.current = 0;
          initPlayer();
        }
      }
      
      // Reset le compteur si tout va bien
      if (timeSinceLastUpdate < 3000) {
        frozenCountRef.current = 0;
      }
    }, 3000);
  };

  const createMpegtsPlayer = () => {
    if (!videoRef.current) return null;
    
    const video = videoRef.current;
    const url = useProxyRef.current ? getProxiedUrl(streamUrl) : streamUrl;
    
    console.log(`🎬 Creating MPEGTS player (${useProxyRef.current ? 'PROXY' : 'DIRECT'})`);
    
    const player = mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url: url,
      cors: true,
      withCredentials: false,
    }, {
      enableWorker: true,
      enableStashBuffer: true,
      stashInitialSize: 512,
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 12,
      autoCleanupMinBackwardDuration: 4,
      liveBufferLatencyChasing: false,
      fixAudioTimestampGap: true,
      lazyLoad: false,
      lazyLoadMaxDuration: 3 * 60,
      lazyLoadRecoverDuration: 30,
    });

    // Gestion des erreurs avec fallback intelligent
    player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: any) => {
      console.log(`⚠️ MPEGTS Error: ${errorType} - ${errorDetail}`);
      
      // Erreur réseau -> essayer le proxy
      if (!useProxyRef.current && errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
        console.log('🔄 Switching to PROXY mode...');
        useProxyRef.current = true;
        setTimeout(() => initPlayer(), 100);
        return;
      }
      
      // Si déjà en proxy et erreur -> essayer HLS
      if (useProxyRef.current && errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
        console.log('🔄 Trying HLS fallback...');
        currentPlayerTypeRef.current = 'hls';
        setTimeout(() => initPlayer(), 100);
        return;
      }
      
      // Autres erreurs -> reconnexion
      if (errorType === mpegts.ErrorTypes.MEDIA_ERROR) {
        console.log('🔄 Media error, reconnecting...');
        setTimeout(() => initPlayer(), 500);
      }
    });

    player.attachMediaElement(video);
    player.load();
    
    video.volume = volume;
    video.muted = isMuted;
    
    if (autoPlay) {
      video.play().then(() => {
        setIsPlaying(true);
        setIsLoading(false);
        setError(null);
        startHealthMonitoring();
      }).catch((e) => {
        console.log('Play error:', e);
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }

    return player;
  };

  const createHlsPlayer = () => {
    if (!videoRef.current || !Hls.isSupported()) {
      console.log('HLS not supported, falling back to MPEGTS');
      currentPlayerTypeRef.current = 'mpegts';
      return null;
    }
    
    const video = videoRef.current;
    const url = getProxiedUrl(streamUrl);
    
    console.log('🎬 Creating HLS player (PROXY)');
    
    const hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 10,
      maxBufferLength: 30,
      maxBufferSize: 60 * 1000 * 1000,
      maxBufferHole: 0.5,
      manifestLoadingTimeOut: 10000,
      fragLoadingTimeOut: 20000,
      manifestLoadingMaxRetry: 3,
      fragLoadingMaxRetry: 6,
      manifestLoadingRetryDelay: 500,
      levelLoadingRetryDelay: 500,
      fragLoadingRetryDelay: 500,
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.log(`❌ HLS fatal error: ${data.type} - ${data.details}`);
        
        switch(data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log('🔄 HLS network error, trying to recover...');
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('🔄 HLS media error, trying to recover...');
            hls.recoverMediaError();
            break;
          default:
            // Si HLS échoue, retour à MPEGTS
            console.log('🔄 HLS failed, falling back to MPEGTS');
            currentPlayerTypeRef.current = 'mpegts';
            setTimeout(() => initPlayer(), 500);
            break;
        }
      }
    });

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('✅ HLS manifest parsed');
      video.play().then(() => {
        setIsPlaying(true);
        setIsLoading(false);
        setError(null);
        startHealthMonitoring();
      }).catch((e) => {
        console.log('HLS play error:', e);
        setIsLoading(false);
      });
    });

    hls.loadSource(url);
    hls.attachMedia(video);
    
    video.volume = volume;
    video.muted = isMuted;

    return hls;
  };

  const initPlayer = () => {
    if (!videoRef.current) return;
    
    cleanup();
    setIsLoading(true);
    
    // Choisir le player selon la stratégie
    const playerType = currentPlayerTypeRef.current || 'mpegts';
    
    if (playerType === 'hls') {
      const hls = createHlsPlayer();
      if (hls) {
        hlsRef.current = hls;
      } else {
        // Fallback to mpegts if HLS creation failed
        const mpegts = createMpegtsPlayer();
        if (mpegts) {
          mpegtsRef.current = mpegts;
          currentPlayerTypeRef.current = 'mpegts';
        }
      }
    } else {
      const mpegts = createMpegtsPlayer();
      if (mpegts) {
        mpegtsRef.current = mpegts;
        currentPlayerTypeRef.current = 'mpegts';
      }
    }

    // Reconnexion proactive toutes les 20 secondes
    reconnectTimerRef.current = setInterval(() => {
      if (!videoRef.current) return;
      
      console.log('🔄 Proactive reconnect (20s)');
      
      const video = videoRef.current;
      const wasPlaying = !video.paused;
      
      // Nettoyer le player actuel
      if (currentPlayerTypeRef.current === 'mpegts' && mpegtsRef.current) {
        try {
          mpegtsRef.current.unload();
          mpegtsRef.current.detachMediaElement();
          mpegtsRef.current.destroy();
        } catch (e) {}
        
        const newPlayer = createMpegtsPlayer();
        if (newPlayer) {
          mpegtsRef.current = newPlayer;
        }
      } else if (currentPlayerTypeRef.current === 'hls' && hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch (e) {}
        
        const newPlayer = createHlsPlayer();
        if (newPlayer) {
          hlsRef.current = newPlayer;
        }
      }
      
      if (wasPlaying) {
        video.play().catch(() => {});
      }
    }, 20000);
  };

  // Suivre les timeupdate pour le monitoring
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      lastTimeUpdateRef.current = Date.now();
    };

    const handleWaiting = () => {
      console.log('⏳ Video waiting for data...');
      setIsLoading(true);
    };

    const handlePlaying = () => {
      console.log('▶️ Video playing');
      setIsLoading(false);
      setIsPlaying(true);
    };

    const handleError = () => {
      console.log('❌ Video element error');
      setError('Erreur de lecture');
      setIsLoading(false);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('error', handleError);
    };
  }, []);

  useEffect(() => {
    if (!streamUrl) return;
    
    // Reset pour nouvelle URL
    useProxyRef.current = false;
    currentPlayerTypeRef.current = 'mpegts';
    
    initPlayer();
    
    return () => cleanup();
  }, [streamUrl]);

  const handlePlayPause = () => {
    if (!videoRef.current) return;
    
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      if (newVolume > 0 && isMuted) {
        setIsMuted(false);
        videoRef.current.muted = false;
      }
    }
  };

  const handleMuteToggle = () => {
    if (!videoRef.current) return;
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    videoRef.current.muted = newMuted;
  };

  const handleFullscreen = () => {
    if (!videoRef.current) return;
    if (videoRef.current.requestFullscreen) {
      videoRef.current.requestFullscreen();
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
      <video
        ref={videoRef}
        className="w-full h-full"
        playsInline
      />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <span className="text-sm text-muted-foreground">
              {currentPlayerTypeRef.current === 'hls' ? 'HLS' : 'MPEGTS'} • 
              {useProxyRef.current ? ' Proxy' : ' Direct'}
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-destructive/90 text-destructive-foreground px-4 py-2 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {showControls && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4 space-y-3">
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
