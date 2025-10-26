import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import mpegts from "mpegts.js";
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { cn } from "@/lib/utils";

interface VideoPlayerProps {
  streamUrl: string;
  autoPlay?: boolean;
}

type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

export const VideoPlayer = ({ streamUrl, autoPlay = true }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const lastPlaybackTimeRef = useRef(0);
  const healthCheckIntervalRef = useRef<NodeJS.Timeout>();
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string>("");
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();

  const cleanupPlayer = () => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (mpegtsRef.current) {
      mpegtsRef.current.destroy();
      mpegtsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current);
    }
  };

  const attemptReconnect = () => {
    setStatus("loading");
    setError("");
    reconnectAttemptsRef.current += 1;
    
    const delay = Math.min(2000, 500 * reconnectAttemptsRef.current);
    console.log(`Reconnect attempt ${reconnectAttemptsRef.current} in ${delay}ms`);
    
    reconnectTimeoutRef.current = setTimeout(() => {
      initializePlayer();
    }, delay);
  };

  const startHealthCheck = () => {
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current);
    }

    healthCheckIntervalRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;

      const currentTime = video.currentTime;
      
      // If video hasn't progressed in 10 seconds and should be playing, reconnect
      if (status === "playing" && currentTime === lastPlaybackTimeRef.current) {
        console.log("Stream stalled - forcing reconnect");
        attemptReconnect();
      }
      
      lastPlaybackTimeRef.current = currentTime;
    }, 10000); // Check every 10 seconds
  };

  const initializePlayer = () => {
    if (!videoRef.current || !streamUrl) return;

    cleanupPlayer();
    setStatus("loading");
    setError("");

    const video = videoRef.current;
    const isHLS = streamUrl.includes(".m3u8") || streamUrl.includes("m3u8");
    const isTS = streamUrl.includes(".ts") || streamUrl.includes("transport-stream");

    try {
      if (isHLS && Hls.isSupported()) {
        // HLS streaming with aggressive recovery settings
        const hls = new Hls({
          enableWorker: true,
          autoStartLoad: true,
          startFragPrefetch: true,
          lowLatencyMode: true,
          backBufferLength: 10,
          maxBufferLength: 20,
          maxMaxBufferLength: 40,
          liveSyncDuration: 6,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10,
          liveDurationInfinity: true,
          maxLoadingDelay: 4,
          maxBufferHole: 0.5,
          highBufferWatchdogPeriod: 2,
          nudgeOffset: 0.1,
          nudgeMaxRetry: 10,
          maxFragLookUpTolerance: 0.25,
          manifestLoadingTimeOut: 20000,
          manifestLoadingMaxRetry: 6,
          manifestLoadingRetryDelay: 1000,
          levelLoadingTimeOut: 20000,
          levelLoadingMaxRetry: 6,
          levelLoadingRetryDelay: 1000,
          fragLoadingTimeOut: 40000,
          fragLoadingMaxRetry: 10,
          fragLoadingRetryDelay: 1000,
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log("HLS manifest parsed successfully");
          reconnectAttemptsRef.current = 0; // Reset counter on success
          startHealthCheck();
          if (autoPlay) {
            const playPromise = video.play();
            if (playPromise !== undefined) {
              playPromise.catch(() => setStatus("paused"));
            }
          }
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          console.log("HLS Error:", data.type, data.details, data.fatal);
          
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.log("Network error - attempting recovery");
                hls.startLoad();
                setTimeout(() => {
                  if (hls && video.paused) {
                    attemptReconnect();
                  }
                }, 3000);
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.log("Media error - attempting recovery");
                hls.recoverMediaError();
                setTimeout(() => {
                  if (video.paused && status === "playing") {
                    video.play().catch(() => attemptReconnect());
                  }
                }, 1000);
                break;
              default:
                console.log("Fatal error - full reconnect");
                setTimeout(() => attemptReconnect(), 1000);
                break;
            }
          } else {
            // Non-fatal errors - try to recover silently
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            }
          }
        });

        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hlsRef.current = hls;
      } else if (isTS && mpegts.isSupported()) {
        // MPEG-TS streaming with optimized settings
        const player = mpegts.createPlayer({
          type: "mpegts",
          isLive: true,
          url: streamUrl,
        }, {
          enableWorker: true,
          enableStashBuffer: false,
          stashInitialSize: 128,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 10,
          autoCleanupMinBackwardDuration: 5,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 3,
          liveBufferLatencyMinRemain: 0.5,
          liveSync: true,
          lazyLoad: false,
          lazyLoadMaxDuration: 3 * 60,
          lazyLoadRecoverDuration: 30,
          deferLoadAfterSourceOpen: false,
        });

        player.attachMediaElement(video);
        player.load();

        player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: string) => {
          console.log("MPEG-TS Error:", errorType, errorDetail);
          // Auto-recovery for all errors with retry
          setTimeout(() => {
            if (mpegtsRef.current) {
              attemptReconnect();
            }
          }, 1000);
        });

        player.on(mpegts.Events.MEDIA_INFO, () => {
          console.log("MPEG-TS media info received");
          reconnectAttemptsRef.current = 0; // Reset counter on success
          startHealthCheck();
        });

        if (autoPlay) {
          try {
            player.play();
          } catch (e) {
            setStatus("paused");
          }
        }

        mpegtsRef.current = player;
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS support (Safari)
        console.log("Using native HLS support");
        video.src = streamUrl;
        reconnectAttemptsRef.current = 0;
        startHealthCheck();
        if (autoPlay) {
          const playPromise = video.play();
          if (playPromise !== undefined) {
            playPromise.catch(() => setStatus("paused"));
          }
        }
      } else {
        console.error("No supported player for this stream format");
        setError("Format de flux non supporté");
        setStatus("error");
      }
    } catch (err) {
      console.error("Player initialization error:", err);
      setTimeout(() => attemptReconnect(), 2000);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => {
      setIsPlaying(true);
      setStatus("playing");
      reconnectAttemptsRef.current = 0; // Reset on successful play
    };

    const handlePause = () => {
      setIsPlaying(false);
      setStatus("paused");
    };

    const handleWaiting = () => {
      setStatus("loading");
    };

    const handleError = () => {
      console.log("Video element error - attempting reconnect");
      setTimeout(() => attemptReconnect(), 2000);
    };

    const handleStalled = () => {
      console.log("Video stalled - attempting recovery");
      if (video && !video.paused && status === "playing") {
        // Try to skip ahead slightly to unstall
        const currentTime = video.currentTime;
        if (currentTime > 0) {
          video.currentTime = currentTime + 0.1;
        }
        video.play().catch(() => {
          console.log("Play failed during stall recovery");
          setTimeout(() => attemptReconnect(), 1000);
        });
      }
    };

    const handleSuspend = () => {
      // Browser suspended loading - try to resume
      if (status === "playing" && video && video.paused) {
        console.log("Stream suspended - resuming");
        video.load();
        video.play().catch(() => {});
      }
    };

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("error", handleError);
    video.addEventListener("stalled", handleStalled);
    video.addEventListener("suspend", handleSuspend);

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("error", handleError);
      video.removeEventListener("stalled", handleStalled);
      video.removeEventListener("suspend", handleSuspend);
    };
  }, []);

  useEffect(() => {
    if (streamUrl) {
      initializePlayer();
    }
    return () => cleanupPlayer();
  }, [streamUrl]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = isMuted ? 0 : volume;
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
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video bg-[hsl(var(--player-bg))] rounded-lg overflow-hidden shadow-[var(--shadow-elevated)] group"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <video
        ref={videoRef}
        className="w-full h-full"
        playsInline
      />

      {/* Status Overlay - Only show loading, auto-hide errors */}
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-[hsl(var(--player-bg))]/90 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Connexion au flux...</p>
          </div>
        </div>
      )}

      {/* Controls */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-4 transition-opacity duration-300",
          showControls || !isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        <div className="flex items-center gap-4">
          <Button
            onClick={togglePlay}
            variant="ghost"
            size="icon"
            className="hover:bg-[hsl(var(--player-hover))] text-foreground"
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </Button>

          <div className="flex items-center gap-2 min-w-[120px]">
            <Button
              onClick={toggleMute}
              variant="ghost"
              size="icon"
              className="hover:bg-[hsl(var(--player-hover))] text-foreground"
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

          {status === "playing" && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[hsl(var(--success))] animate-pulse" />
              <span className="text-xs text-[hsl(var(--success))]">EN DIRECT</span>
            </div>
          )}

          <Button
            onClick={toggleFullscreen}
            variant="ghost"
            size="icon"
            className="hover:bg-[hsl(var(--player-hover))] text-foreground"
          >
            <Maximize className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
};
