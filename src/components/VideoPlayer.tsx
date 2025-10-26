import { useEffect, useRef, useState } from "react";
import mpegts from "mpegts.js";
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const mpegtsRef = useRef<any>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const useProxyRef = useRef(false);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);

  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();

  const cleanup = () => {
    if (reconnectTimerRef.current) {
      clearInterval(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    
    if (mpegtsRef.current) {
      try {
        mpegtsRef.current.unload();
        mpegtsRef.current.detachMediaElement();
        mpegtsRef.current.destroy();
      } catch (e) {
        console.log('Cleanup error:', e);
      }
      mpegtsRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
  };

  const createPlayer = () => {
    if (!videoRef.current) return null;
    
    const video = videoRef.current;
    const url = useProxyRef.current ? getProxiedUrl(streamUrl) : streamUrl;
    
    console.log(`🎬 Creating player with ${useProxyRef.current ? 'PROXY' : 'DIRECT'} URL`);
    
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
      autoCleanupMaxBackwardDuration: 10,
      autoCleanupMinBackwardDuration: 3,
      liveBufferLatencyChasing: false,
      fixAudioTimestampGap: true,
    });

    // Gestion des erreurs avec fallback vers proxy
    player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: any) => {
      console.log(`⚠️ MPEGTS Error: ${errorType} - ${errorDetail}`);
      
      // Si erreur réseau et pas encore en mode proxy, basculer vers proxy
      if (!useProxyRef.current && errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
        console.log('🔄 Switching to PROXY mode...');
        useProxyRef.current = true;
        
        // Nettoyer et recréer
        try {
          player.unload();
          player.detachMediaElement();
          player.destroy();
        } catch (e) {}
        
        // Relancer avec proxy
        setTimeout(() => initPlayer(), 100);
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
      }).catch((e) => {
        console.log('Play error:', e);
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }

    return player;
  };

  const initPlayer = () => {
    if (!mpegts.isSupported()) {
      console.error('mpegts.js not supported');
      return;
    }
    
    cleanup();
    
    const player = createPlayer();
    if (!player) return;
    
    mpegtsRef.current = player;

    // Reconnexion proactive toutes les 22 secondes
    reconnectTimerRef.current = setInterval(() => {
      if (!videoRef.current || !mpegtsRef.current) return;
      
      console.log('🔄 Proactive reconnect (22s)');
      
      const video = videoRef.current;
      const wasPlaying = !video.paused;
      
      try {
        mpegtsRef.current.unload();
        mpegtsRef.current.detachMediaElement();
        mpegtsRef.current.destroy();
      } catch (e) {}
      
      const newPlayer = createPlayer();
      if (newPlayer) {
        mpegtsRef.current = newPlayer;
        
        if (wasPlaying) {
          video.play().catch(() => {});
        }
      }
    }, 22000);
  };

  useEffect(() => {
    if (!streamUrl) return;
    
    // Reset proxy mode pour nouvelle URL
    useProxyRef.current = false;
    
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
          <Loader2 className="w-12 h-12 text-primary animate-spin" />
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
