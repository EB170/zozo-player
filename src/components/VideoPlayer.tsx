import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
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

type PlayerType = 'hls' | 'videojs' | 'native' | null;

const getProxiedUrl = (originalUrl: string): string => {
  const projectId = "wxkvljkvqcamktlwfmfx";
  const proxyUrl = `https://${projectId}.supabase.co/functions/v1/stream-proxy`;
  return `${proxyUrl}?url=${encodeURIComponent(originalUrl)}`;
};

export const VideoPlayer = ({ streamUrl, autoPlay = true }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const videojsRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [currentPlayer, setCurrentPlayer] = useState<PlayerType>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playerAttempts, setPlayerAttempts] = useState<PlayerType[]>([]);
  
  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();
  const loadingTimeoutRef = useRef<NodeJS.Timeout>();
  const retryTimeoutRef = useRef<NodeJS.Timeout>();
  const { toast } = useToast();

  // Cleanup function
  const cleanupPlayers = () => {
    if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    
    if (videojsRef.current) {
      videojsRef.current.dispose();
      videojsRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
  };

  // Try HLS.js player
  const tryHlsPlayer = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!videoRef.current || !Hls.isSupported()) {
        console.log('HLS.js not supported');
        resolve(false);
        return;
      }

      console.log('Trying HLS.js player...');
      const video = videoRef.current;
      const proxiedUrl = getProxiedUrl(streamUrl);
      
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 3,
        levelLoadingTimeOut: 15000,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 6,
      });

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log('HLS.js timeout');
          hls.destroy();
          resolve(false);
        }
      }, 10000);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log('HLS.js success!');
          hlsRef.current = hls;
          setCurrentPlayer('hls');
          
          video.play()
            .then(() => setIsPlaying(true))
            .catch(() => {});
          
          resolve(true);
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log('HLS.js fatal error:', data.details);
          hls.destroy();
          resolve(false);
        }
      });

      hls.loadSource(proxiedUrl);
      hls.attachMedia(video);
    });
  };

  // Try Video.js player
  const tryVideojsPlayer = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!videoRef.current) {
        resolve(false);
        return;
      }

      console.log('Trying Video.js player...');
      const proxiedUrl = getProxiedUrl(streamUrl);
      
      try {
        const player = videojs(videoRef.current, {
          controls: false,
          autoplay: false,
          preload: 'auto',
          html5: {
            vhs: {
              overrideNative: true,
              experimentalBufferBasedABR: true,
            },
          },
          sources: [{
            src: proxiedUrl,
            type: 'video/mp2t'
          }]
        });

        videojsRef.current = player;
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.log('Video.js timeout');
            player.dispose();
            videojsRef.current = null;
            resolve(false);
          }
        }, 10000);

        player.on('canplay', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('Video.js success!');
            setCurrentPlayer('videojs');
            
            player.play()
              .then(() => setIsPlaying(true))
              .catch(() => {});
            
            resolve(true);
          }
        });

        player.on('error', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('Video.js error');
            player.dispose();
            videojsRef.current = null;
            resolve(false);
          }
        });
      } catch (error) {
        console.log('Video.js initialization error:', error);
        resolve(false);
      }
    });
  };

  // Try native player
  const tryNativePlayer = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!videoRef.current) {
        resolve(false);
        return;
      }

      console.log('Trying native player...');
      const video = videoRef.current;
      const proxiedUrl = getProxiedUrl(streamUrl);
      
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log('Native player timeout');
          resolve(false);
        }
      }, 10000);

      const onCanPlay = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log('Native player success!');
          setCurrentPlayer('native');
          
          video.play()
            .then(() => setIsPlaying(true))
            .catch(() => {});
          
          video.removeEventListener('canplay', onCanPlay);
          video.removeEventListener('error', onError);
          resolve(true);
        }
      };

      const onError = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log('Native player error');
          video.removeEventListener('canplay', onCanPlay);
          video.removeEventListener('error', onError);
          resolve(false);
        }
      };

      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('error', onError);
      video.src = proxiedUrl;
      video.load();
    });
  };

  // Try all players sequentially
  const tryPlayers = async () => {
    cleanupPlayers();
    setIsLoading(true);
    setError(null);
    
    const strategies: Array<{ name: PlayerType, fn: () => Promise<boolean> }> = [
      { name: 'hls', fn: tryHlsPlayer },
      { name: 'videojs', fn: tryVideojsPlayer },
      { name: 'native', fn: tryNativePlayer },
    ];

    const attempted: PlayerType[] = [];

    for (const strategy of strategies) {
      attempted.push(strategy.name);
      setPlayerAttempts([...attempted]);
      
      console.log(`\n=== Trying ${strategy.name} player ===`);
      const success = await strategy.fn();
      
      if (success) {
        setIsLoading(false);
        toast({
          title: "Flux connecté",
          description: `Lecture avec ${strategy.name} player`,
        });
        return;
      }
      
      // Small delay between attempts
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // All players failed
    console.error('All players failed');
    setIsLoading(false);
    setError('Impossible de lire ce flux avec tous les lecteurs disponibles. Le flux peut être incompatible ou indisponible.');
    toast({
      title: "Erreur de lecture",
      description: "Tous les lecteurs ont échoué",
      variant: "destructive",
    });
  };

  useEffect(() => {
    tryPlayers();

    return () => {
      cleanupPlayers();
    };
  }, [streamUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = isMuted ? 0 : volume;
      video.muted = isMuted;
    }
    if (videojsRef.current) {
      videojsRef.current.volume(isMuted ? 0 : volume);
      videojsRef.current.muted(isMuted);
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
    
    if (videojsRef.current) {
      if (isPlaying) {
        videojsRef.current.pause();
      } else {
        videojsRef.current.play();
      }
    } else {
      if (isPlaying) {
        video.pause();
      } else {
        video.play().catch(() => {});
      }
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
    tryPlayers();
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-[var(--shadow-elevated)] group"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <div data-vjs-player className="w-full h-full">
        <video
          ref={videoRef}
          className="video-js vjs-default-skin w-full h-full"
          playsInline
        />
      </div>

      {/* Loading Overlay */}
      {isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <div className="text-center">
              <p className="text-sm text-white mb-2">Connexion au flux...</p>
              {playerAttempts.length > 0 && (
                <p className="text-xs text-gray-400">
                  Essai: {playerAttempts.join(' → ')}
                </p>
              )}
            </div>
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
              <p className="text-xs text-gray-500 mt-2">
                Lecteurs testés: {playerAttempts.join(', ')}
              </p>
            </div>
            <Button
              onClick={handleRetry}
              variant="outline"
              className="mt-2"
            >
              Réessayer tous les lecteurs
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

          {isPlaying && !isLoading && currentPlayer && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-red-500 font-semibold">● EN DIRECT</span>
              <span className="text-xs text-gray-400 ml-2">({currentPlayer})</span>
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
