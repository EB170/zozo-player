import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import videojs from "video.js";
import Clappr from "@clappr/player";
import DPlayer from "dplayer";
import * as PlyrImport from "plyr";
import "video.js/dist/video-js.css";
import "plyr/dist/plyr.css";

// @ts-ignore
const Plyr = PlyrImport.default || PlyrImport;

declare const shaka: any;
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface VideoPlayerProps {
  streamUrl: string;
  autoPlay?: boolean;
}

type PlayerType = 'clappr' | 'dplayer' | 'hls' | 'shaka' | 'plyr' | 'videojs' | 'native' | null;

const getProxiedUrl = (originalUrl: string): string => {
  const projectId = "wxkvljkvqcamktlwfmfx";
  const proxyUrl = `https://${projectId}.supabase.co/functions/v1/stream-proxy`;
  return `${proxyUrl}?url=${encodeURIComponent(originalUrl)}`;
};

export const VideoPlayer = ({ streamUrl, autoPlay = true }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  
  const hlsRef = useRef<Hls | null>(null);
  const videojsRef = useRef<any>(null);
  const clapprRef = useRef<any>(null);
  const dplayerRef = useRef<any>(null);
  const plyrRef = useRef<any>(null);
  const shakaRef = useRef<any>(null);
  
  const [currentPlayer, setCurrentPlayer] = useState<PlayerType>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playerAttempts, setPlayerAttempts] = useState<PlayerType[]>([]);
  
  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();
  const { toast } = useToast();

  const cleanupPlayers = () => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (videojsRef.current) {
      videojsRef.current.dispose();
      videojsRef.current = null;
    }
    if (clapprRef.current) {
      clapprRef.current.destroy();
      clapprRef.current = null;
    }
    if (dplayerRef.current) {
      dplayerRef.current.destroy();
      dplayerRef.current = null;
    }
    if (plyrRef.current) {
      plyrRef.current.destroy();
      plyrRef.current = null;
    }
    if (shakaRef.current) {
      shakaRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
  };

  // Clappr Player - Excellent pour IPTV Live
  const tryClapprPlayer = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!playerContainerRef.current) {
        resolve(false);
        return;
      }

      console.log('Trying Clappr player...');
      const proxiedUrl = getProxiedUrl(streamUrl);
      
      try {
        const player = new Clappr.Player({
          parent: playerContainerRef.current,
          source: proxiedUrl,
          mute: false,
          autoPlay: true,
          width: '100%',
          height: '100%',
          playback: {
            playInline: true,
            recycleVideo: true,
          },
        });

        clapprRef.current = player;
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.log('Clappr timeout');
            player.destroy();
            clapprRef.current = null;
            resolve(false);
          }
        }, 12000);

        player.on(Clappr.Events.PLAYER_PLAY, () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('Clappr success!');
            setCurrentPlayer('clappr');
            setIsPlaying(true);
            resolve(true);
          }
        });

        player.on(Clappr.Events.PLAYER_ERROR, () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('Clappr error');
            player.destroy();
            clapprRef.current = null;
            resolve(false);
          }
        });
      } catch (error) {
        console.log('Clappr initialization error:', error);
        resolve(false);
      }
    });
  };

  // DPlayer - Spécialisé IPTV
  const tryDPlayerPlayer = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!playerContainerRef.current) {
        resolve(false);
        return;
      }

      console.log('Trying DPlayer...');
      const proxiedUrl = getProxiedUrl(streamUrl);
      
      try {
        const player = new DPlayer({
          container: playerContainerRef.current,
          video: {
            url: proxiedUrl,
            type: 'auto',
          },
          autoplay: true,
          live: true,
        });

        dplayerRef.current = player;
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.log('DPlayer timeout');
            player.destroy();
            dplayerRef.current = null;
            resolve(false);
          }
        }, 12000);

        player.on('play', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('DPlayer success!');
            setCurrentPlayer('dplayer');
            setIsPlaying(true);
            resolve(true);
          }
        });

        player.on('error', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('DPlayer error');
            player.destroy();
            dplayerRef.current = null;
            resolve(false);
          }
        });
      } catch (error) {
        console.log('DPlayer initialization error:', error);
        resolve(false);
      }
    });
  };

  // Shaka Player - Google's robust player
  const tryShakaPlayer = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!videoRef.current) {
        resolve(false);
        return;
      }

      console.log('Trying Shaka player...');
      const video = videoRef.current;
      const proxiedUrl = getProxiedUrl(streamUrl);

      try {
        shaka.polyfill.installAll();

        const player = new shaka.Player();
        player.attach(video);
        shakaRef.current = player;

        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.log('Shaka timeout');
            resolve(false);
          }
        }, 12000);

        player.load(proxiedUrl)
          .then(() => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              console.log('Shaka success!');
              setCurrentPlayer('shaka');
              
              video.play()
                .then(() => setIsPlaying(true))
                .catch(() => {});
              
              resolve(true);
            }
          })
          .catch((error: any) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              console.log('Shaka error:', error);
              resolve(false);
            }
          });
      } catch (error) {
        console.log('Shaka initialization error:', error);
        resolve(false);
      }
    });
  };

  // Plyr with HLS
  const tryPlyrPlayer = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!videoRef.current) {
        resolve(false);
        return;
      }

      console.log('Trying Plyr player...');
      const video = videoRef.current;
      const proxiedUrl = getProxiedUrl(streamUrl);

      try {
        const player = new Plyr(video, {
          controls: [],
          autoplay: true,
          muted: false,
        });

        plyrRef.current = player;
        video.src = proxiedUrl;

        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.log('Plyr timeout');
            player.destroy();
            plyrRef.current = null;
            resolve(false);
          }
        }, 12000);

        player.on('playing', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('Plyr success!');
            setCurrentPlayer('plyr');
            setIsPlaying(true);
            resolve(true);
          }
        });

        player.on('error', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('Plyr error');
            player.destroy();
            plyrRef.current = null;
            resolve(false);
          }
        });

        video.load();
      } catch (error) {
        console.log('Plyr initialization error:', error);
        resolve(false);
      }
    });
  };

  // HLS.js
  const tryHlsPlayer = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!videoRef.current || !Hls.isSupported()) {
        resolve(false);
        return;
      }

      console.log('Trying HLS.js player...');
      const video = videoRef.current;
      const proxiedUrl = getProxiedUrl(streamUrl);
      
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        maxBufferLength: 30,
        manifestLoadingTimeOut: 15000,
        fragLoadingTimeOut: 20000,
      });

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log('HLS.js timeout');
          hls.destroy();
          resolve(false);
        }
      }, 12000);

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
          console.log('HLS.js fatal error');
          hls.destroy();
          resolve(false);
        }
      });

      hls.loadSource(proxiedUrl);
      hls.attachMedia(video);
    });
  };

  // Video.js
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
          sources: [{ src: proxiedUrl, type: 'video/mp2t' }]
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
        }, 12000);

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
        console.log('Video.js error:', error);
        resolve(false);
      }
    });
  };

  // Native player
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
      }, 12000);

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

  const tryPlayers = async () => {
    cleanupPlayers();
    setIsLoading(true);
    setError(null);
    
    const strategies: Array<{ name: PlayerType, fn: () => Promise<boolean> }> = [
      { name: 'clappr', fn: tryClapprPlayer },
      { name: 'dplayer', fn: tryDPlayerPlayer },
      { name: 'hls', fn: tryHlsPlayer },
      { name: 'shaka', fn: tryShakaPlayer },
      { name: 'plyr', fn: tryPlyrPlayer },
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
          description: `Lecture avec ${strategy.name}`,
        });
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    console.error('All 7 players failed');
    setIsLoading(false);
    setError('Aucun des 7 lecteurs disponibles ne peut lire ce flux. Le flux est peut-être hors ligne ou incompatible.');
    toast({
      title: "Erreur de lecture",
      description: "Tous les lecteurs ont échoué",
      variant: "destructive",
    });
  };

  useEffect(() => {
    // Load Shaka Player dynamically
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.10/shaka-player.compiled.min.js';
    script.onload = () => {
      tryPlayers();
    };
    script.onerror = () => {
      console.error('Failed to load Shaka Player');
      tryPlayers();
    };
    document.head.appendChild(script);

    return () => {
      cleanupPlayers();
      document.head.removeChild(script);
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
    if (clapprRef.current) {
      clapprRef.current.setVolume(isMuted ? 0 : volume * 100);
    }
    if (dplayerRef.current) {
      dplayerRef.current.volume(isMuted ? 0 : volume, isMuted);
    }
    if (plyrRef.current) {
      plyrRef.current.volume = isMuted ? 0 : volume;
      plyrRef.current.muted = isMuted;
    }
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
    if (clapprRef.current) {
      isPlaying ? clapprRef.current.pause() : clapprRef.current.play();
    } else if (dplayerRef.current) {
      isPlaying ? dplayerRef.current.pause() : dplayerRef.current.play();
    } else if (plyrRef.current) {
      isPlaying ? plyrRef.current.pause() : plyrRef.current.play();
    } else if (videojsRef.current) {
      isPlaying ? videojsRef.current.pause() : videojsRef.current.play();
    } else if (videoRef.current) {
      isPlaying ? videoRef.current.pause() : videoRef.current.play().catch(() => {});
    }
  };

  const toggleMute = () => setIsMuted(!isMuted);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    document.fullscreenElement ? document.exitFullscreen() : containerRef.current.requestFullscreen();
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-[var(--shadow-elevated)] group"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <div ref={playerContainerRef} className="absolute inset-0" />
      <div data-vjs-player className="absolute inset-0">
        <video ref={videoRef} className="video-js vjs-default-skin w-full h-full" playsInline />
      </div>

      {isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <div className="text-center">
              <p className="text-sm text-white mb-2">Test des lecteurs...</p>
              <p className="text-xs text-gray-400">{playerAttempts.join(' → ')}</p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-4 p-6 text-center max-w-md">
            <AlertCircle className="w-12 h-12 text-destructive" />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-white">Impossible de charger le flux</p>
              <p className="text-xs text-gray-400">{error}</p>
              <p className="text-xs text-gray-500 mt-2">Testés: {playerAttempts.join(', ')}</p>
            </div>
            <Button onClick={tryPlayers} variant="outline" className="mt-2">
              Réessayer tous les lecteurs
            </Button>
          </div>
        </div>
      )}

      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-4 transition-opacity duration-300 z-20",
          showControls || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        <div className="flex items-center gap-4">
          <Button onClick={togglePlay} variant="ghost" size="icon" className="hover:bg-white/20 text-white">
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </Button>

          <div className="flex items-center gap-2 min-w-[120px]">
            <Button onClick={toggleMute} variant="ghost" size="icon" className="hover:bg-white/20 text-white">
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
              <span className="text-xs text-red-500 font-semibold">● EN DIRECT ({currentPlayer})</span>
            </div>
          )}

          <Button onClick={toggleFullscreen} variant="ghost" size="icon" className="hover:bg-white/20 text-white">
            <Maximize className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
};
