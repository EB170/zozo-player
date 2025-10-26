import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
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
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();
  const loadingTimeoutRef = useRef<NodeJS.Timeout>();
  const { toast } = useToast();

  useEffect(() => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    setError(null);
    setIsLoading(true);

    const proxiedUrl = getProxiedUrl(streamUrl);
    console.log('Original URL:', streamUrl);
    console.log('Proxied URL:', proxiedUrl);

    // Set loading timeout
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
    }
    loadingTimeoutRef.current = setTimeout(() => {
      if (isLoading) {
        const errorMsg = 'Le flux vidéo ne répond pas. Le flux peut être temporairement indisponible.';
        setError(errorMsg);
        setIsLoading(false);
        
        toast({
          title: "Erreur de chargement",
          description: errorMsg,
          variant: "destructive",
        });
      }
    }, 20000); // 20 seconds timeout

    // Check if HLS is supported
    if (Hls.isSupported()) {
      console.log('HLS.js is supported, initializing...');
      
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 3,
        maxFragLookUpTolerance: 0.25,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        liveDurationInfinity: true,
        liveBackBufferLength: 0,
        maxLiveSyncPlaybackRate: 1.5,
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 500,
        levelLoadingTimeOut: 20000,
        levelLoadingMaxRetry: 6,
        fragLoadingTimeOut: 30000,
        fragLoadingMaxRetry: 12,
        fragLoadingRetryDelay: 500,
        xhrSetup: (xhr: XMLHttpRequest, url: string) => {
          // Ensure all requests go through proxy
          if (!url.includes('stream-proxy')) {
            const proxied = getProxiedUrl(url);
            xhr.open('GET', proxied, true);
          }
        },
      });

      hlsRef.current = hls;

      // HLS event listeners
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        console.log('HLS: Media attached');
      });

      hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        console.log('HLS: Manifest parsed, levels:', data.levels.length);
        setIsLoading(false);
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
        }
        
        if (autoPlay) {
          video.play()
            .then(() => {
              console.log('HLS: Autoplay started');
              setIsPlaying(true);
            })
            .catch((err) => {
              console.error('HLS: Autoplay failed', err);
              // User interaction required for autoplay
              setIsLoading(false);
            });
        }
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        setIsLoading(false);
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS Error:', data.type, data.details, data.fatal);
        
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('HLS: Fatal network error, trying to recover...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('HLS: Fatal media error, trying to recover...');
              hls.recoverMediaError();
              break;
            default:
              console.error('HLS: Fatal error, cannot recover');
              setError('Impossible de lire le flux. Le format n\'est pas supporté ou le flux est corrompu.');
              setIsLoading(false);
              toast({
                title: "Erreur fatale",
                description: "Impossible de lire ce flux vidéo.",
                variant: "destructive",
              });
              hls.destroy();
              break;
          }
        }
      });

      // Load source
      hls.loadSource(proxiedUrl);
      hls.attachMedia(video);

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      console.log('Native HLS support detected');
      video.src = proxiedUrl;
      
      video.addEventListener('loadedmetadata', () => {
        console.log('Native HLS: Metadata loaded');
        setIsLoading(false);
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
        }
      });

      if (autoPlay) {
        video.play()
          .then(() => {
            setIsPlaying(true);
          })
          .catch((err) => {
            console.error('Native HLS: Autoplay failed', err);
            setIsLoading(false);
          });
      }
    } else {
      // Direct TS stream fallback
      console.log('No HLS support, trying direct stream...');
      video.src = proxiedUrl;
      
      video.addEventListener('loadeddata', () => {
        console.log('Direct stream: Data loaded');
        setIsLoading(false);
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
        }
      });

      if (autoPlay) {
        video.play()
          .then(() => {
            setIsPlaying(true);
          })
          .catch((err) => {
            console.error('Direct stream: Autoplay failed', err);
            setIsLoading(false);
          });
      }
    }

    // Video element event listeners
    const handlePlay = () => {
      console.log('Video: Playing');
      setIsPlaying(true);
      setIsLoading(false);
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };

    const handlePause = () => {
      console.log('Video: Paused');
      setIsPlaying(false);
    };

    const handleWaiting = () => {
      console.log('Video: Waiting for data');
      setIsLoading(true);
    };

    const handleCanPlay = () => {
      console.log('Video: Can play');
      setIsLoading(false);
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };

    const handleError = (e: Event) => {
      console.error('Video element error:', e);
      const videoError = video.error;
      if (videoError) {
        console.error('Video error code:', videoError.code, 'message:', videoError.message);
        setError(`Erreur de lecture: ${videoError.message}`);
        setIsLoading(false);
      }
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleError);

    // Cleanup
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
      
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
      
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl, autoPlay]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = isMuted ? 0 : volume;
      video.muted = isMuted;
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
    const video = videoRef.current;
    if (!video) return;
    
    if (isPlaying) {
      video.pause();
    } else {
      video.play().catch((error: any) => {
        console.log('Play failed:', error);
      });
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  };

  const handleRetry = () => {
    setError(null);
    setIsLoading(true);
    const video = videoRef.current;
    
    if (video && hlsRef.current) {
      const proxiedUrl = getProxiedUrl(streamUrl);
      hlsRef.current.loadSource(proxiedUrl);
      hlsRef.current.attachMedia(video);
    } else if (video) {
      video.src = getProxiedUrl(streamUrl);
      video.load();
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-[var(--shadow-elevated)] group"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <video
        ref={videoRef}
        className="w-full h-full"
        playsInline
        controls={false}
      />

      {/* Loading Overlay */}
      {isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Connexion au flux...</p>
          </div>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-4 p-6 text-center max-w-md">
            <AlertCircle className="w-12 h-12 text-destructive" />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-white">Impossible de charger le flux</p>
              <p className="text-xs text-gray-400">{error}</p>
            </div>
            <Button
              onClick={handleRetry}
              variant="outline"
              className="mt-2"
            >
              Réessayer
            </Button>
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
