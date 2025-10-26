import { Activity, Wifi, Gauge, AlertCircle, TrendingUp, TrendingDown, Minus, Zap } from "lucide-react";
import { useVideoMetrics } from "@/hooks/useVideoMetrics";

interface PlayerStatsProps {
  videoElement: HTMLVideoElement | null;
  playerType: 'mpegts' | 'hls';
  useProxy: boolean;
  bufferHealth: number;
  isVisible: boolean;
  networkSpeed: 'fast' | 'medium' | 'slow';
  bandwidthMbps: number;
  bandwidthTrend: 'stable' | 'increasing' | 'decreasing';
  realBitrate?: number; // Ajout du bitrate réel mesuré
}

export const PlayerStats = ({ 
  videoElement, 
  playerType, 
  useProxy, 
  bufferHealth, 
  isVisible, 
  networkSpeed,
  bandwidthMbps,
  bandwidthTrend,
  realBitrate = 0
}: PlayerStatsProps) => {
  const metrics = useVideoMetrics(videoElement);

  if (!isVisible) return null;

  const getHealthColor = () => {
    if (bufferHealth > 70) return "text-green-400";
    if (bufferHealth > 40) return "text-yellow-400";
    return "text-red-400";
  };

  const getTrendIcon = () => {
    if (bandwidthTrend === 'increasing') return TrendingUp;
    if (bandwidthTrend === 'decreasing') return TrendingDown;
    return Minus;
  };

  const TrendIcon = getTrendIcon();
  const healthColor = getHealthColor();

  const getDropRate = () => {
    if (metrics.totalFrames === 0) return 0;
    return ((metrics.droppedFrames / metrics.totalFrames) * 100).toFixed(2);
  };

  return (
    <div className="absolute top-4 right-4 bg-black/95 backdrop-blur-xl border border-primary/40 rounded-xl p-4 text-xs space-y-3 w-72 shadow-2xl z-30 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-primary font-bold">
          <Activity className="w-4 h-4 animate-pulse" />
          <span className="text-sm">Analytics Pro</span>
        </div>
        <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
          bufferHealth > 70 ? 'bg-green-400/20 text-green-400' :
          bufferHealth > 40 ? 'bg-yellow-400/20 text-yellow-400' :
          'bg-red-400/20 text-red-400'
        }`}>
          LIVE
        </div>
      </div>
      
      <div className="space-y-2.5 text-white/90">
        {/* Stream Info */}
        <div className="bg-white/5 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-white/70 text-[11px]">
              <Wifi className="w-3.5 h-3.5" />
              Protocole
            </span>
            <span className="font-mono text-primary font-semibold">
              {playerType.toUpperCase()}
            </span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-white/70 text-[11px]">
              <TrendingUp className="w-3.5 h-3.5" />
              Source
            </span>
            <span className="font-mono text-accent font-semibold">
              {useProxy ? 'Proxy 🔒' : 'Direct ⚡'}
            </span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-white/70 text-[11px]">
              Réseau
            </span>
            <span className="font-mono text-white font-semibold">
              {networkSpeed === 'fast' ? '5G 📶' : networkSpeed === 'medium' ? '4G 📶' : '3G 📶'}
            </span>
          </div>
        </div>

        {/* Video Quality */}
        <div className="bg-white/5 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-white/70 text-[11px]">Qualité</span>
            <span className="font-mono text-primary font-bold">{metrics.resolution}</span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-white/70 text-[11px]">Bitrate réel</span>
            <span className="font-mono font-semibold">
              {metrics.actualBitrate > 0 ? `${metrics.actualBitrate.toFixed(1)} Mb/s` : 'Calcul...'}
            </span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-white/70 text-[11px]">FPS</span>
            <span className="font-mono font-semibold">{metrics.fps} fps</span>
          </div>
        </div>

        {/* Buffer & Network */}
        <div className="bg-white/5 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-white/70 text-[11px]">
              <Gauge className="w-3.5 h-3.5" />
              Buffer Health
            </span>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-20 bg-white/20 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-300 ${
                    bufferHealth > 70 ? 'bg-green-400' : 
                    bufferHealth > 40 ? 'bg-yellow-400' : 'bg-red-400'
                  }`}
                  style={{ width: `${bufferHealth}%` }}
                />
              </div>
              <span className={`font-mono font-bold text-xs ${healthColor}`}>
                {bufferHealth}%
              </span>
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-white/70 text-[11px]">Buffer</span>
            <span className="font-mono font-semibold">{metrics.bufferLevel.toFixed(1)}s</span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-white/70 text-[11px]">Latence</span>
            <span className="font-mono font-semibold">{metrics.latency}ms</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-white/70 text-[11px]">
              <TrendIcon className="w-3.5 h-3.5" />
              Bande passante
            </span>
            <span className="font-mono font-semibold">{bandwidthMbps.toFixed(1)} Mb/s</span>
          </div>

          {realBitrate > 0 && (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-white/70 text-[11px]">
                <Zap className="w-3.5 h-3.5" />
                Débit réel mesuré
              </span>
              <span className="font-mono font-semibold text-green-400">{realBitrate.toFixed(2)} Mb/s</span>
            </div>
          )}
        </div>

        {/* Performance Metrics */}
        {(metrics.droppedFrames > 0 || metrics.totalFrames > 0) && (
          <div className="bg-white/5 rounded-lg p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-white/70 text-[11px]">Frames total</span>
              <span className="font-mono font-semibold">{metrics.totalFrames.toLocaleString()}</span>
            </div>
            
            {metrics.droppedFrames > 0 && (
              <>
                <div className="flex items-center justify-between text-yellow-400">
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Frames perdus
                  </span>
                  <span className="font-mono font-bold">{metrics.droppedFrames}</span>
                </div>
                <div className="flex items-center justify-between text-yellow-400">
                  <span className="text-[11px]">Taux de perte</span>
                  <span className="font-mono font-bold">{getDropRate()}%</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer hints */}
      <div className="pt-2 border-t border-white/10">
        <div className="flex items-center gap-1.5 text-[10px] text-white/50">
          <Zap className="w-3 h-3" />
          <span>Métriques temps réel • Maj. toutes les secondes</span>
        </div>
      </div>
    </div>
  );
};
