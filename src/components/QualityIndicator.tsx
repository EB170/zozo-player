import { Signal, SignalHigh, SignalLow, SignalMedium } from "lucide-react";

interface QualityIndicatorProps {
  resolution: string;
  bitrate: number;
  bufferHealth: number;
}

export const QualityIndicator = ({ resolution, bitrate, bufferHealth }: QualityIndicatorProps) => {
  const getQualityColor = () => {
    if (bufferHealth > 70 && bitrate > 5) return "text-green-400";
    if (bufferHealth > 40 && bitrate > 2) return "text-yellow-400";
    return "text-red-400";
  };

  const getSignalIcon = () => {
    if (bufferHealth > 70) return SignalHigh;
    if (bufferHealth > 40) return SignalMedium;
    if (bufferHealth > 10) return SignalLow;
    return Signal;
  };

  const SignalIcon = getSignalIcon();
  const qualityColor = getQualityColor();

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/90 backdrop-blur-xl border border-white/20 rounded-full px-4 py-2 flex items-center gap-2 z-30 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-300">
      <SignalIcon className={`w-4 h-4 ${qualityColor}`} />
      <div className="flex items-center gap-2 text-xs font-mono">
        <span className={`font-bold ${qualityColor}`}>{resolution}</span>
        {bitrate > 0 && (
          <>
            <span className="text-white/40">•</span>
            <span className="text-white/80">{bitrate.toFixed(1)} Mb/s</span>
          </>
        )}
      </div>
      <div className={`w-2 h-2 rounded-full ${qualityColor.replace('text-', 'bg-')} animate-pulse`} />
    </div>
  );
};
