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
  realBitrate?: number;
  healthStatus?: any;
  abrState?: any;
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
  realBitrate = 0,
  healthStatus,
  abrState
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
        <div className="flex items-center gap-1.5">
          {healthStatus && (
            <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              healthStatus.level === 'excellent' ? 'bg-green-400/20 text-green-400' :
              healthStatus.level === 'good' ? 'bg-blue-400/20 text-blue-400' :
              healthStatus.level === 'warning' ? 'bg-yellow-400/20 text-yellow-400' :
              'bg-red-400/20 text-red-400'
            }`}>
              {healthStatus.score}/100
            </div>
          )}
          <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
            bufferHealth > 70 ? 'bg-green-400/20 text-green-400' :
            bufferHealth > 40 ? 'bg-yellow-400/20 text-yellow-400' :
            'bg-red-400/20 text-red-400'
          }`}>
            LIVE
          </div>
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

        {/* ABR Status */}
        {abrState && abrState.currentQuality && (
          <div className="bg-primary/10 rounded-lg p-2.5 space-y-2 border border-primary/30">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-primary text-[11px] font-semibold">
                <Zap className="w-3.5 h-3.5" />
                ABR Actif
              </span>
              <span className="font-mono text-primary font-bold text-xs">
                {abrState.currentQuality.label}
              </span>
            </div>
            {abrState.isAdapting && abrState.targetQuality && (
              <div className="text-[10px] text-yellow-400 animate-pulse">
                → Passage vers {abrState.targetQuality.label}
              </div>
            )}
            {abrState.switchCount > 0 && (
              <div className="text-[10px] text-white/60">
                {abrState.switchCount} adaptation{abrState.switchCount > 1 ? 's' : ''}
              </div>
            )}
          </div>
        )}

        {/* Health Issues */}
        {healthStatus && healthStatus.issues.length > 0 && (
          <div className="bg-red-500/10 rounded-lg p-2.5 space-y-1.5 border border-red-500/30">
            <div className="flex items-center gap-1.5 text-red-400 text-[11px] font-semibold">
              <AlertCircle className="w-3.5 h-3.5" />
              Problèmes détectés
            </div>
            {healthStatus.issues.map((issue: string, i: number) => (
              <div key={i} className="text-[10px] text-red-300">
                • {issue}
              </div>
            ))}
            {healthStatus.recommendations.length > 0 && (
              <div className="mt-2 pt-2 border-t border-red-500/20">
                <div className="text-[10px] text-yellow-300 font-semibold mb-1">
                  Recommandations:
                </div>
                {healthStatus.recommendations.map((rec: string, i: number) => (
                  <div key={i} className="text-[10px] text-yellow-200">
                    → {rec}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
