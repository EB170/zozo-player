import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { cn } from "@/lib/utils";

interface VideoPlayerProps {
  streamUrl: string;
  autoPlay?: boolean;
}

export const VideoPlayer = ({ streamUrl, autoPlay = true }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();

  const attemptReconnect = () => {
    reconnectAttemptsRef.current += 1;
    const delay = Math.min(3000, 500 * reconnectAttemptsRef.current);
    console.log(`Reconnect attempt ${reconnectAttemptsRef.current} in ${delay}ms`);
    
    reconnectTimeoutRef.current = setTimeout(() => {
      if (videoRef.current && streamUrl) {
        console.log("Forcing video reload...");
        videoRef.current.load();
        if (autoPlay) {
          setTimeout(() => {
            videoRef.current?.play().catch(e => {
              console.log("Play failed, will retry:", e);
              if (reconnectAttemptsRef.current < 50) {
                attemptReconnect();
              }
            });
          }, 300);
        }
      }
    }, delay);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    console.log("Initializing player with URL:", streamUrl);
    setIsLoading(true);
    reconnectAttemptsRef.current = 0;

    // Clear any pending reconnects
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    // Force video to load
    video.src = streamUrl;
    video.load();

    const handleLoadStart = () => {
      console.log("Load started");
      setIsLoading(true);
    };

    const handleLoadedMetadata = () => {
      console.log("Metadata loaded");
      setIsLoading(false);
      reconnectAttemptsRef.current = 0;
    };

    const handleLoadedData = () => {
      console.log("Data loaded, attempting autoplay");
      if (autoPlay && video.paused) {
        video.play().catch((e) => {
          console.log("Autoplay blocked:", e);
          setIsPlaying(false);
          setIsLoading(false);
        });
      }
    };

    const handleCanPlay = () => {
      console.log("Can play");
      setIsLoading(false);
      if (autoPlay && video.paused) {
        video.play().catch(() => {});
      }
    };

    const handlePlay = () => {
      console.log("Playing");
      setIsPlaying(true);
      setIsLoading(false);
      reconnectAttemptsRef.current = 0;
    };

    const handlePause = () => {
      console.log("Paused");
      setIsPlaying(false);
    };

    const handleWaiting = () => {
      console.log("Waiting for data...");
      setIsLoading(true);
      // Give it 8 seconds before attempting reconnect
      setTimeout(() => {
        if (video && video.readyState < 3) {
          console.log("Still waiting after 8s, attempting reconnect");
          attemptReconnect();
        }
      }, 8000);
    };

    const handlePlaying = () => {
      console.log("Playing smoothly");
      setIsLoading(false);
      setIsPlaying(true);
    };

    const handleError = (e: Event) => {
      const error = video.error;
      console.log("Video error:", error?.code, error?.message);
      setIsLoading(false);
      
      // Try to reconnect on any error
      setTimeout(() => {
        if (reconnectAttemptsRef.current < 50) {
          attemptReconnect();
        }
      }, 2000);
    };

    const handleStalled = () => {
      console.log("Stream stalled, attempting recovery");
      if (video && !video.paused) {
        // Try to skip forward slightly
        const currentTime = video.currentTime;
        if (currentTime > 0) {
          video.currentTime = currentTime + 0.1;
        }
        video.play().catch(() => {
          console.log("Recovery failed, reconnecting");
          setTimeout(() => attemptReconnect(), 1000);
        });
      }
    };

    const handleSuspend = () => {
      console.log("Playback suspended, resuming");
      if (video && video.paused && isPlaying) {
        video.load();
        video.play().catch(() => {});
      }
    };

    // Attach all event listeners
    video.addEventListener("loadstart", handleLoadStart);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("error", handleError);
    video.addEventListener("stalled", handleStalled);
    video.addEventListener("suspend", handleSuspend);

    // Try to play after a short delay
    if (autoPlay) {
      setTimeout(() => {
        video.play().catch((e) => {
          console.log("Initial play attempt failed:", e);
          setIsPlaying(false);
        });
      }, 500);
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      video.removeEventListener("loadstart", handleLoadStart);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("error", handleError);
      video.removeEventListener("stalled", handleStalled);
      video.removeEventListener("suspend", handleSuspend);
    };
  }, [streamUrl, autoPlay]);


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
      videoRef.current.play().catch((error) => {
        console.log("Play failed:", error);
        attemptReconnect();
      });
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
        preload="auto"
        crossOrigin="anonymous"
      />

      {/* Loading Overlay */}
      {isLoading && (
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

          {isPlaying && !isLoading && (
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
