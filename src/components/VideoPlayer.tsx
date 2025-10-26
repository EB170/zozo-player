import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import videojs from "video.js";
import Clappr from "@clappr/player";
import mpegts from "mpegts.js";
import "video.js/dist/video-js.css";
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface VideoPlayerProps {
  streamUrl: string;
  autoPlay?: boolean;
}

type PlayerType = 'mpegts' | 'hls' | 'clappr' | 'videojs' | 'native' | null;

const getProxiedUrl = (originalUrl: string): string => {
  const projectId = "wxkvljkvqcamktlwfmfx";
  const proxyUrl = `https://${projectId}.supabase.co/functions/v1/stream-proxy`;
  return `${proxyUrl}?url=${encodeURIComponent(originalUrl)}`;
};

export const VideoPlayer = ({ streamUrl, autoPlay = true }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoRef2 = useRef<HTMLVideoElement>(null); // DUAL BUFFER
  const containerRef = useRef<HTMLDivElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  
  const mpegtsRef = useRef<any>(null);
  const mpegtsRef2 = useRef<any>(null); // DUAL BUFFER
  const hlsRef = useRef<Hls | null>(null);
  const videojsRef = useRef<any>(null);
  const clapprRef = useRef<any>(null);
  
  const activeVideoRef = useRef<1 | 2>(1); // Which video is active
  
  const [currentPlayer, setCurrentPlayer] = useState<PlayerType>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playerAttempts, setPlayerAttempts] = useState<string[]>([]);
  const [hasRealData, setHasRealData] = useState(false);
  
  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();
  const { toast } = useToast();

  const cleanupPlayers = () => {
    // Safe cleanup with null checks
    if (mpegtsRef.current) {
      try {
        if (mpegtsRef.current.destroy) mpegtsRef.current.destroy();
      } catch (e) {}
      mpegtsRef.current = null;
    }
    if (mpegtsRef2.current) {
      try {
        if (mpegtsRef2.current.destroy) mpegtsRef2.current.destroy();
      } catch (e) {}
      mpegtsRef2.current = null;
    }
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch (e) {}
      hlsRef.current = null;
    }
    if (videojsRef.current) {
      try {
        videojsRef.current.dispose();
      } catch (e) {}
      videojsRef.current = null;
    }
    if (clapprRef.current) {
      try {
        clapprRef.current.destroy();
      } catch (e) {}
      clapprRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
    if (videoRef2.current) {
      videoRef2.current.pause();
      videoRef2.current.removeAttribute('src');
      videoRef2.current.load();
    }
  };

  // Verify that video actually has data playing - SIMPLE version without stealing audio
  const verifyRealPlayback = (videoElement: HTMLVideoElement): Promise<boolean> => {
    return new Promise((resolve) => {
      let bytesReceived = 0;
      let timeUpdateCount = 0;
      const startTime = Date.now();
      
      const checkInterval = setInterval(() => {
        const buffered = videoElement.buffered;
        
        // Check if we have buffered data
        if (buffered.length > 0) {
          const bufferedEnd = buffered.end(buffered.length - 1);
          if (bufferedEnd > 0) {
            bytesReceived++;
          }
        }
        
        // Check if time is progressing
        if (videoElement.currentTime > 0 && !videoElement.paused) {
          timeUpdateCount++;
        }
        
        // Success: buffered data AND playback started
        if (bytesReceived > 0 && timeUpdateCount > 0) {
          clearInterval(checkInterval);
          console.log(`✅ Playback verified: ${bytesReceived} buffer checks, ${timeUpdateCount} time updates`);
          resolve(true);
        }
        
        // Timeout after 3 seconds
        if (Date.now() - startTime > 3000) {
          clearInterval(checkInterval);
          const success = bytesReceived > 0 || timeUpdateCount > 0;
          console.log(`${success ? '✅' : '❌'} Playback verification timeout: buffer=${bytesReceived}, time=${timeUpdateCount}`);
          resolve(success);
        }
      }, 200);
    });
  };

  // MPEGTS.js - SEAMLESS DUAL-BUFFER NO-INTERRUPTION MODE
  const tryMpegtsPlayer = (): Promise<boolean> => {
    return new Promise(async (resolve) => {
      if (!videoRef.current || !videoRef2.current || !mpegts.isSupported()) {
        console.log('mpegts.js not supported or refs missing');
        resolve(false);
        return;
      }

      console.log('==================================================');
      console.log('🎬 SEAMLESS DUAL-BUFFER MODE - ZERO INTERRUPTION...');
      const video1 = videoRef.current;
      const video2 = videoRef2.current;
      const proxiedUrl = getProxiedUrl(streamUrl);
      
      let player1: any = null;
      let player2: any = null;
      let isActive = true;
      let switchInterval: NodeJS.Timeout | null = null;
      let currentActive: 1 | 2 = 1;
      
      // Cleanup both players
      const cleanup = () => {
        console.log('🧹 Cleaning up dual buffers...');
        isActive = false;
        
        if (switchInterval) {
          clearInterval(switchInterval);
          switchInterval = null;
        }
        
        if (player1) {
          try {
            player1.unload();
            player1.detachMediaElement();
            player1.destroy();
          } catch (e) {}
          player1 = null;
        }
        
        if (player2) {
          try {
            player2.unload();
            player2.detachMediaElement();
            player2.destroy();
          } catch (e) {}
          player2 = null;
        }
        
        video1.removeAttribute('src');
        video1.load();
        video2.removeAttribute('src');
        video2.load();
      };
      
      // Create a player instance on a video element
      const createPlayerOnVideo = (video: HTMLVideoElement, playerRef: 'player1' | 'player2') => {
        console.log(`🎮 Creating player on ${playerRef}...`);
        
        const player = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: proxiedUrl,
        }, {
          enableWorker: true,
          enableStashBuffer: true,
          stashInitialSize: 1024, // LARGE buffer
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 15,
          autoCleanupMinBackwardDuration: 5,
          liveBufferLatencyChasing: false,
          fixAudioTimestampGap: true,
        });

        player.attachMediaElement(video);
        player.load();
        
        video.addEventListener('loadedmetadata', async () => {
          console.log(`📋 Metadata loaded on ${playerRef}`);
          video.volume = volume;
          video.muted = isMuted;
          
          try {
            await video.play();
            console.log(`▶️ ${playerRef} playing`);
          } catch (err) {
            console.log(`❌ ${playerRef} play failed:`, err);
          }
        }, { once: true });
        
        // Ignore ended events - we switch before they happen
        video.addEventListener('ended', (e) => {
          e.preventDefault();
          console.log(`⚠️ ${playerRef} ended - but we should have switched already`);
        });

        return player;
      };
      
      // Seamless switch between players
      const switchPlayer = () => {
        if (!isActive) return;
        
        const nextActive: 1 | 2 = currentActive === 1 ? 2 : 1;
        const currentVideo = currentActive === 1 ? video1 : video2;
        const nextVideo = nextActive === 1 ? video1 : video2;
        const currentPlayer = currentActive === 1 ? player1 : player2;
        const nextPlayer = nextActive === 1 ? player1 : player2;
        
        console.log(`🔄 SEAMLESS SWITCH: ${currentActive} → ${nextActive}`);
        
        // Make next video visible and playing
        nextVideo.style.opacity = '1';
        nextVideo.style.zIndex = '2';
        if (nextVideo.paused) {
          nextVideo.play().catch(e => console.log('Switch play error:', e));
        }
        
        // Fade out current video
        currentVideo.style.opacity = '0';
        currentVideo.style.zIndex = '1';
        
        // Update active reference
        currentActive = nextActive;
        activeVideoRef.current = nextActive;
        
        // After transition, recreate the old player for next switch
        setTimeout(() => {
          if (!isActive) return;
          
          // Destroy old player
          if (currentPlayer) {
            try {
              currentPlayer.unload();
              currentPlayer.detachMediaElement();
              currentPlayer.destroy();
            } catch (e) {}
          }
          
          // Recreate it fresh
          const newPlayer = createPlayerOnVideo(currentVideo, currentActive === 1 ? 'player2' : 'player1');
          if (currentActive === 1) {
            player2 = newPlayer;
            mpegtsRef2.current = newPlayer;
          } else {
            player1 = newPlayer;
            mpegtsRef.current = newPlayer;
          }
          
          console.log(`♻️ Recreated ${currentActive === 1 ? 'player2' : 'player1'} for next switch`);
        }, 1000);
      };
      
      // Initialize both players
      console.log('🚀 Initializing DUAL BUFFER system...');
      
      // Create both players
      player1 = createPlayerOnVideo(video1, 'player1');
      mpegtsRef.current = player1;
      
      // Start with slight delay to avoid race
      setTimeout(() => {
        player2 = createPlayerOnVideo(video2, 'player2');
        mpegtsRef2.current = player2;
      }, 2000);
      
      // Set initial visibility
      video1.style.opacity = '1';
      video1.style.zIndex = '2';
      video1.style.transition = 'opacity 0.5s ease';
      
      video2.style.opacity = '0';
      video2.style.zIndex = '1';
      video2.style.transition = 'opacity 0.5s ease';
      
      // AUTOMATIC SWITCH every 25 seconds (before MediaSource ends at ~38s)
      switchInterval = setInterval(() => {
        if (!isActive) return;
        switchPlayer();
      }, 25000);
      
      // Initial verification on video1
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log('❌ Initial timeout');
          isActive = false;
          cleanup();
          resolve(false);
        }
      }, 15000);

      setTimeout(async () => {
        if (resolved) return;
        
        const hasData = await verifyRealPlayback(video1);
        
        if (hasData) {
          resolved = true;
          clearTimeout(timeout);
          console.log('✅ SEAMLESS DUAL-BUFFER MODE ACTIVE - ZERO INTERRUPTION!');
          setCurrentPlayer('mpegts');
          setIsPlaying(true);
          setHasRealData(true);
          resolve(true);
        } else if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log('❌ No real data');
          isActive = false;
          cleanup();
          resolve(false);
        }
      }, 4000);
    });
  };

  // HLS.js - Best for HLS streams
  const tryHlsPlayer = (): Promise<boolean> => {
    return new Promise(async (resolve) => {
      if (!videoRef.current || !Hls.isSupported()) {
        console.log('HLS.js not supported');
        resolve(false);
        return;
      }

      console.log('🎬 Trying HLS.js...');
      const video = videoRef.current;
      const proxiedUrl = getProxiedUrl(streamUrl);
      
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        manifestLoadingTimeOut: 10000,
        fragLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 3,
      });

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log('❌ HLS.js timeout');
          hls.destroy();
          resolve(false);
        }
      }, 8000);

      hls.on(Hls.Events.MANIFEST_PARSED, async () => {
        if (resolved) return;
        console.log('📋 HLS.js manifest parsed');
        
        try {
          await video.play();
          
          // Verify real playback
          const hasData = await verifyRealPlayback(video);
          
          if (!resolved && hasData) {
            resolved = true;
            clearTimeout(timeout);
            console.log('✅ HLS.js SUCCESS with real data!');
            hlsRef.current = hls;
            setCurrentPlayer('hls');
            setIsPlaying(true);
            setHasRealData(true);
            resolve(true);
          } else if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('❌ HLS.js no real data');
            hls.destroy();
            resolve(false);
          }
        } catch (err) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('❌ HLS.js play failed');
            hls.destroy();
            resolve(false);
          }
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log('❌ HLS.js fatal error:', data.details);
          hls.destroy();
          resolve(false);
        }
      });

      hls.loadSource(proxiedUrl);
      hls.attachMedia(video);
    });
  };

  // Clappr - Excellent for live IPTV
  const tryClapprPlayer = (): Promise<boolean> => {
    return new Promise(async (resolve) => {
      if (!playerContainerRef.current) {
        resolve(false);
        return;
      }

      console.log('🎬 Trying Clappr...');
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
            console.log('❌ Clappr timeout');
            player.destroy();
            clapprRef.current = null;
            resolve(false);
          }
        }, 8000);

        player.on(Clappr.Events.PLAYER_PLAY, async () => {
          if (resolved) return;
          console.log('▶️ Clappr playing event');
          
          // Get video element from Clappr
          const videoEl = player.core?.activePlayback?.el as HTMLVideoElement;
          if (videoEl) {
            const hasData = await verifyRealPlayback(videoEl);
            
            if (!resolved && hasData) {
              resolved = true;
              clearTimeout(timeout);
              console.log('✅ Clappr SUCCESS with real data!');
              setCurrentPlayer('clappr');
              setIsPlaying(true);
              setHasRealData(true);
              resolve(true);
            } else if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              console.log('❌ Clappr no real data');
              player.destroy();
              clapprRef.current = null;
              resolve(false);
            }
          }
        });

        player.on(Clappr.Events.PLAYER_ERROR, () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('❌ Clappr error');
            player.destroy();
            clapprRef.current = null;
            resolve(false);
          }
        });
      } catch (error) {
        console.log('❌ Clappr init error:', error);
        resolve(false);
      }
    });
  };

  // Video.js - Robust fallback
  const tryVideojsPlayer = (): Promise<boolean> => {
    return new Promise(async (resolve) => {
      if (!videoRef.current) {
        resolve(false);
        return;
      }

      console.log('🎬 Trying Video.js...');
      const proxiedUrl = getProxiedUrl(streamUrl);
      
      try {
        const player = videojs(videoRef.current, {
          controls: false,
          autoplay: false,
          preload: 'auto',
          html5: {
            vhs: {
              overrideNative: true,
            },
          },
          sources: [{ 
            src: proxiedUrl, 
            type: streamUrl.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp2t'
          }]
        });

        videojsRef.current = player;
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.log('❌ Video.js timeout');
            player.dispose();
            videojsRef.current = null;
            resolve(false);
          }
        }, 8000);

        player.on('canplay', async () => {
          if (resolved) return;
          console.log('▶️ Video.js can play');
          
          try {
            await player.play();
            const videoEl = player.el().querySelector('video') as HTMLVideoElement;
            
            if (videoEl) {
              const hasData = await verifyRealPlayback(videoEl);
              
              if (!resolved && hasData) {
                resolved = true;
                clearTimeout(timeout);
                console.log('✅ Video.js SUCCESS with real data!');
                setCurrentPlayer('videojs');
                setIsPlaying(true);
                setHasRealData(true);
                resolve(true);
              } else if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                console.log('❌ Video.js no real data');
                player.dispose();
                videojsRef.current = null;
                resolve(false);
              }
            }
          } catch (err) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              console.log('❌ Video.js play failed');
              player.dispose();
              videojsRef.current = null;
              resolve(false);
            }
          }
        });

        player.on('error', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('❌ Video.js error');
            player.dispose();
            videojsRef.current = null;
            resolve(false);
          }
        });
      } catch (error) {
        console.log('❌ Video.js init error:', error);
        resolve(false);
      }
    });
  };

  // Native HTML5 player
  const tryNativePlayer = (): Promise<boolean> => {
    return new Promise(async (resolve) => {
      if (!videoRef.current) {
        resolve(false);
        return;
      }

      console.log('🎬 Trying Native player...');
      const video = videoRef.current;
      const proxiedUrl = getProxiedUrl(streamUrl);
      
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log('❌ Native timeout');
          resolve(false);
        }
      }, 8000);

      const onCanPlay = async () => {
        if (resolved) return;
        console.log('▶️ Native can play');
        
        try {
          await video.play();
          const hasData = await verifyRealPlayback(video);
          
          if (!resolved && hasData) {
            resolved = true;
            clearTimeout(timeout);
            console.log('✅ Native SUCCESS with real data!');
            setCurrentPlayer('native');
            setIsPlaying(true);
            setHasRealData(true);
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('error', onError);
            resolve(true);
          } else if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('❌ Native no real data');
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('error', onError);
            resolve(false);
          }
        } catch (err) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            console.log('❌ Native play failed');
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('error', onError);
            resolve(false);
          }
        }
      };

      const onError = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log('❌ Native error');
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
    setHasRealData(false);
    
    // Optimized order for IPTV streams - mpegts.js first for MPEG-TS live streams
    const strategies: Array<{ name: PlayerType, fn: () => Promise<boolean> }> = [
      { name: 'mpegts', fn: tryMpegtsPlayer },
      { name: 'hls', fn: tryHlsPlayer },
      { name: 'clappr', fn: tryClapprPlayer },
      { name: 'videojs', fn: tryVideojsPlayer },
      { name: 'native', fn: tryNativePlayer },
    ];

    const attempted: string[] = [];

    for (const strategy of strategies) {
      attempted.push(strategy.name!);
      setPlayerAttempts([...attempted]);
      
      console.log(`\n${'='.repeat(50)}`);
      console.log(`🎯 Testing ${strategy.name?.toUpperCase()} player`);
      console.log('='.repeat(50));
      
      const success = await strategy.fn();
      
      if (success) {
        setIsLoading(false);
        toast({
          title: "✓ Flux connecté",
          description: `Lecture avec ${strategy.name}`,
        });
        return;
      }
      
      // Small delay between attempts
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // All players failed
    console.error('💀 All players failed');
    setIsLoading(false);
    setError('Impossible de lire ce flux. Le serveur peut être temporairement indisponible.');
    toast({
      title: "Erreur de lecture",
      description: "Tous les lecteurs ont échoué",
      variant: "destructive",
    });
  };

  useEffect(() => {
    tryPlayers();
    return () => cleanupPlayers();
  }, [streamUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    
    // Also attach to video2
    if (videoRef2.current) {
      videoRef2.current.addEventListener('play', handlePlay);
      videoRef2.current.addEventListener('pause', handlePause);
    }

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      if (videoRef2.current) {
        videoRef2.current.removeEventListener('play', handlePlay);
        videoRef2.current.removeEventListener('pause', handlePause);
      }
    };
  }, []);

  useEffect(() => {
    if (clapprRef.current) {
      clapprRef.current.setVolume(isMuted ? 0 : volume * 100);
    }
    // Apply to both videos
    [videoRef.current, videoRef2.current].forEach(video => {
      if (video) {
        video.volume = isMuted ? 0 : volume;
        video.muted = isMuted;
      }
    });
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
    } else if (videojsRef.current) {
      isPlaying ? videojsRef.current.pause() : videojsRef.current.play();
    } else {
      // For dual buffer mode, control both videos
      const activeVideo = activeVideoRef.current === 1 ? videoRef.current : videoRef2.current;
      if (activeVideo) {
        isPlaying ? activeVideo.pause() : activeVideo.play().catch(() => {});
      }
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
      
      {/* DUAL VIDEO BUFFERS for seamless switching */}
      <div data-vjs-player className="absolute inset-0">
        <video 
          ref={videoRef} 
          className="video-js vjs-default-skin absolute inset-0 w-full h-full object-contain" 
          playsInline 
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        />
      </div>
      <div className="absolute inset-0">
        <video 
          ref={videoRef2} 
          className="video-js vjs-default-skin absolute inset-0 w-full h-full object-contain" 
          playsInline 
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        />
      </div>

      {isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <div className="text-center">
              <p className="text-sm text-white mb-2">Test des lecteurs vidéo...</p>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                {playerAttempts.map((player, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i === playerAttempts.length - 1 ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <span className="text-red-500">✗</span>
                    )}
                    {player}
                  </span>
                ))}
              </div>
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
            </div>
            <Button onClick={tryPlayers} variant="outline" className="mt-2">
              Réessayer
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

          {isPlaying && !isLoading && currentPlayer && hasRealData && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-green-500/20 px-3 py-1 rounded-full">
                <CheckCircle className="w-3 h-3 text-green-500" />
                <span className="text-xs text-green-500 font-semibold">LIVE</span>
              </div>
              <span className="text-xs text-gray-400">({currentPlayer})</span>
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
