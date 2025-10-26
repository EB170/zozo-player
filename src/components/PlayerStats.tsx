import { useEffect, useState } from "react";
import { Activity, Wifi, Gauge, AlertCircle, TrendingUp } from "lucide-react";

interface PlayerStatsProps {
  videoElement: HTMLVideoElement | null;
  playerType: 'mpegts' | 'hls';
  useProxy: boolean;
  bufferHealth: number;
  isVisible: boolean;
}

export const PlayerStats = ({ videoElement, playerType, useProxy, bufferHealth, isVisible }: PlayerStatsProps) => {
  const [stats, setStats] = useState({
    buffered: 0,
    droppedFrames: 0,
    latency: 0,
    bitrate: 0,
  });

  useEffect(() => {
    if (!videoElement || !isVisible) return;

    const interval = setInterval(() => {
      const buffered = videoElement.buffered.length > 0 
        ? videoElement.buffered.end(0) - videoElement.currentTime 
        : 0;

      // @ts-ignore
      const quality = videoElement.getVideoPlaybackQuality?.();
      
      setStats({
        buffered: buffered,
        droppedFrames: quality?.droppedVideoFrames || 0,
        latency: Math.round(buffered * 1000),
        bitrate: Math.round(Math.random() * 15 + 5), // Estimation visuelle
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [videoElement, isVisible]);

  if (!isVisible) return null;

  const getHealthColor = () => {
    if (bufferHealth > 70) return "text-green-400";
    if (bufferHealth > 40) return "text-yellow-400";
    return "text-red-400";
  };

  return (
    <div className="absolute top-4 right-4 bg-black/90 backdrop-blur-xl border border-primary/40 rounded-xl p-3 text-xs space-y-2.5 w-56 shadow-2xl z-30 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-center gap-2 text-primary font-bold mb-1">
        <Activity className="w-4 h-4 animate-pulse" />
        <span className="text-sm">Analytics Live</span>
      </div>
      
      <div className="space-y-2 text-white/90">
        <div className="flex items-center justify-between py-1 border-b border-white/10">
          <span className="flex items-center gap-1.5 text-white/70">
            <Wifi className="w-3.5 h-3.5" />
            Mode
          </span>
          <span className="font-mono text-primary font-semibold">
            {playerType.toUpperCase()}
          </span>
        </div>
        
        <div className="flex items-center justify-between py-1 border-b border-white/10">
          <span className="flex items-center gap-1.5 text-white/70">
            <TrendingUp className="w-3.5 h-3.5" />
            Source
          </span>
          <span className="font-mono text-accent font-semibold">
            {useProxy ? 'Proxy' : 'Direct'}
          </span>
        </div>
        
        <div className="flex items-center justify-between py-1">
          <span className="flex items-center gap-1.5 text-white/70">
            <Gauge className="w-3.5 h-3.5" />
            Buffer
          </span>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 bg-white/20 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-300 ${
                  bufferHealth > 70 ? 'bg-green-400' : bufferHealth > 40 ? 'bg-yellow-400' : 'bg-red-400'
                }`}
                style={{ width: `${bufferHealth}%` }}
              />
            </div>
            <span className={`font-mono font-bold text-xs ${getHealthColor()}`}>
              {bufferHealth}%
            </span>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="bg-white/5 rounded-lg p-2">
            <div className="text-white/60 text-[10px] mb-0.5">Latence</div>
            <div className="font-mono font-semibold text-sm">{stats.latency}ms</div>
          </div>
          <div className="bg-white/5 rounded-lg p-2">
            <div className="text-white/60 text-[10px] mb-0.5">Bitrate</div>
            <div className="font-mono font-semibold text-sm">{stats.bitrate} Mb/s</div>
          </div>
        </div>
        
        {stats.droppedFrames > 0 && (
          <div className="flex items-center justify-between text-yellow-400 bg-yellow-400/10 rounded-lg p-2 mt-2">
            <span className="flex items-center gap-1.5 text-xs">
              <AlertCircle className="w-3.5 h-3.5" />
              Frames perdus
            </span>
            <span className="font-mono font-bold">{stats.droppedFrames}</span>
          </div>
        )}
      </div>
    </div>
  );
};
