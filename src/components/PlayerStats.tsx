import { useEffect, useState } from "react";
import { Activity, Wifi, Gauge, AlertCircle } from "lucide-react";
import { Card } from "./ui/card";

interface PlayerStatsProps {
  videoElement: HTMLVideoElement | null;
  playerType: 'mpegts' | 'hls';
  useProxy: boolean;
  bufferHealth: number;
}

export const PlayerStats = ({ videoElement, playerType, useProxy, bufferHealth }: PlayerStatsProps) => {
  const [stats, setStats] = useState({
    currentTime: 0,
    buffered: 0,
    fps: 0,
    droppedFrames: 0,
    latency: 0,
    bitrate: 0,
  });

  useEffect(() => {
    if (!videoElement) return;

    const interval = setInterval(() => {
      const buffered = videoElement.buffered.length > 0 
        ? videoElement.buffered.end(0) - videoElement.currentTime 
        : 0;

      // @ts-ignore - API non-standard mais disponible dans certains navigateurs
      const videoPlaybackQuality = videoElement.getVideoPlaybackQuality?.();
      
      setStats({
        currentTime: videoElement.currentTime,
        buffered: buffered,
        fps: videoPlaybackQuality?.totalVideoFrames || 0,
        droppedFrames: videoPlaybackQuality?.droppedVideoFrames || 0,
        latency: Math.round(buffered * 1000),
        bitrate: Math.round((videoElement.currentTime / (Date.now() / 1000)) * 8), // Estimation
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [videoElement]);

  const getHealthColor = () => {
    if (bufferHealth > 70) return "text-green-500";
    if (bufferHealth > 40) return "text-yellow-500";
    return "text-red-500";
  };

  return (
    <Card className="absolute top-4 right-4 bg-black/80 backdrop-blur-sm border-primary/30 p-3 text-xs space-y-2 w-64 z-30">
      <div className="flex items-center gap-2 text-primary font-semibold mb-2">
        <Activity className="w-4 h-4" />
        <span>Stats Live</span>
      </div>
      
      <div className="space-y-1.5 text-white/80">
        <div className="flex justify-between">
          <span className="flex items-center gap-1">
            <Wifi className="w-3 h-3" />
            Mode:
          </span>
          <span className="font-mono text-primary">
            {playerType.toUpperCase()} {useProxy ? '• Proxy' : '• Direct'}
          </span>
        </div>
        
        <div className="flex justify-between">
          <span className="flex items-center gap-1">
            <Gauge className="w-3 h-3" />
            Buffer:
          </span>
          <span className={`font-mono font-bold ${getHealthColor()}`}>
            {stats.buffered.toFixed(1)}s ({bufferHealth}%)
          </span>
        </div>
        
        <div className="flex justify-between">
          <span>Latence:</span>
          <span className="font-mono">{stats.latency}ms</span>
        </div>
        
        <div className="flex justify-between">
          <span>Bitrate:</span>
          <span className="font-mono">{stats.bitrate} Mbps</span>
        </div>
        
        {stats.droppedFrames > 0 && (
          <div className="flex justify-between text-yellow-500">
            <span className="flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Frames perdus:
            </span>
            <span className="font-mono">{stats.droppedFrames}</span>
          </div>
        )}
      </div>
    </Card>
  );
};
