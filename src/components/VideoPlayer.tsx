import { useEffect, useRef, useState } from "react";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface VideoPlayerProps {
  streamUrl: string;
  autoPlay?: boolean;
}

// Helper function to proxy stream URLs through our backend
const getProxiedUrl = (originalUrl: string): string => {
  const projectId = "wxkvljkvqcamktlwfmfx";
  const proxyUrl = `https://${projectId}.supabase.co/functions/v1/stream-proxy`;
  return `${proxyUrl}?url=${encodeURIComponent(originalUrl)}`;
};

export const VideoPlayer = ({ streamUrl, autoPlay = true }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();
  const { toast } = useToast();

  useEffect(() => {
    if (!videoRef.current) return;

    setError(null);
    const proxiedUrl = getProxiedUrl(streamUrl);
    console.log('Original URL:', streamUrl);
    console.log('Proxied URL:', proxiedUrl);

    // Initialize Video.js with aggressive live streaming options
    const player = videojs(videoRef.current, {
      controls: false, // We'll use custom controls
      autoplay: autoPlay,
      preload: "auto",
      liveui: true,
      fluid: true,
      responsive: true,
      aspectRatio: "16:9",
      html5: {
        vhs: {
          // Video.js HTTP Streaming (VHS) options for HLS/DASH
          enableLowInitialPlaylist: false,
          smoothQualityChange: true,
          overrideNative: true,
          useBandwidthFromLocalStorage: false,
          limitRenditionByPlayerDimensions: false,
          useNetworkInformationApi: true,
          useDtsForTimestampOffset: true,
          experimentalBufferBasedABR: true,
          experimentalLLHLS: false, // Disable for compatibility
          // Aggressive retry and timeout settings
          withCredentials: false,
          handleManifestRedirects: true,
          // Buffer settings
          bandwidth: 4194304,
          // Error retry
          maxPlaylistRetries: Infinity,
          timeout: 60000,
        },
        nativeAudioTracks: false,
        nativeVideoTracks: false,
        nativeTextTracks: false,
      },
      liveTracker: {
        trackingThreshold: 30,
        liveTolerance: 45,
      },
      sources: [{
        src: proxiedUrl,
        type: streamUrl.includes('.m3u8') ? 'application/x-mpegURL' : 
              streamUrl.includes('.ts') ? 'video/mp2t' : 'application/x-mpegURL'
      }]
    });

    playerRef.current = player;

    // Event listeners
    player.on('loadstart', () => {
      console.log('Video.js: Load started');
      setIsLoading(true);
    });

    player.on('loadedmetadata', () => {
      console.log('Video.js: Metadata loaded');
      setIsLoading(false);
    });

    player.on('canplay', () => {
      console.log('Video.js: Can play');
      setIsLoading(false);
    });

    player.on('playing', () => {
      console.log('Video.js: Playing');
      setIsPlaying(true);
      setIsLoading(false);
    });

    player.on('play', () => {
      console.log('Video.js: Play event');
      setIsPlaying(true);
    });

    player.on('pause', () => {
      console.log('Video.js: Pause event');
      setIsPlaying(false);
    });

    player.on('waiting', () => {
      console.log('Video.js: Waiting for data');
      setIsLoading(true);
    });

    player.on('error', (e: any) => {
      const playerError = player.error();
      console.error('Video.js Error:', playerError);
      
      const errorMessage = playerError?.message || 'Erreur de chargement du flux';
      setError(errorMessage);
      setIsLoading(false);
      
      toast({
        title: "Erreur de lecture",
        description: "Impossible de charger le flux. Vérifiez l'URL ou réessayez.",
        variant: "destructive",
      });
    });

    // Stall recovery
    player.on('stalled', () => {
      console.log('Video.js: Stream stalled, attempting recovery');
      const currentTime = player.currentTime();
      if (currentTime && currentTime > 0) {
        player.currentTime(currentTime + 0.1);
      }
      player.play().catch(() => {});
    });

    // Progress tracking
    player.on('progress', () => {
      setIsLoading(false);
    });

    // Cleanup
    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [streamUrl, autoPlay]);

  useEffect(() => {
    const player = playerRef.current;
    if (player) {
      player.volume(isMuted ? 0 : volume);
      player.muted(isMuted);
    }
  }, [volume, isMuted]);

  const handleMouseMove = () => {
    setShowControls(true);
    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
    }
    hideControlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  };

  const togglePlay = () => {
    const player = playerRef.current;
    if (!player) return;
    
    if (isPlaying) {
      player.pause();
    } else {
      player.play().catch((error: any) => {
        console.log('Play failed:', error);
      });
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const toggleFullscreen = () => {
    const player = playerRef.current;
    if (!player) return;
    
    if (player.isFullscreen()) {
      player.exitFullscreen();
    } else {
      player.requestFullscreen();
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video bg-[hsl(var(--player-bg))] rounded-lg overflow-hidden shadow-[var(--shadow-elevated)] group"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <div data-vjs-player className="w-full h-full">
        <video
          ref={videoRef as any}
          className="video-js vjs-default-skin vjs-big-play-centered w-full h-full"
        />
      </div>

      {/* Loading Overlay */}
      {isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[hsl(var(--player-bg))]/90 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Connexion au flux...</p>
          </div>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[hsl(var(--player-bg))]/90 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-4 p-6 text-center">
            <AlertCircle className="w-12 h-12 text-destructive" />
            <div className="space-y-2">
              <p className="text-sm font-semibold">Impossible de charger le flux</p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Custom Controls Overlay */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-4 transition-opacity duration-300 z-20",
          showControls || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        <div className="flex items-center gap-4">
          <Button
            onClick={togglePlay}
            variant="ghost"
            size="icon"
            className="hover:bg-white/20 text-white"
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </Button>

          <div className="flex items-center gap-2 min-w-[120px]">
            <Button
              onClick={toggleMute}
              variant="ghost"
              size="icon"
              className="hover:bg-white/20 text-white"
            >
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </Button>
            <Slider
              value={[isMuted ? 0 : volume * 100]}
              onValueChange={(value) => setVolume(value[0] / 100)}
              max={100}
              step={1}
              className="w-20"
            />
          </div>

          <div className="flex-1" />

          {isPlaying && !isLoading && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-red-500 font-semibold">● EN DIRECT</span>
            </div>
          )}

          <Button
            onClick={toggleFullscreen}
            variant="ghost"
            size="icon"
            className="hover:bg-white/20 text-white"
          >
            <Maximize className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
};
