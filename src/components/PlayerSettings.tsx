import { Settings, Zap, Gauge, X } from "lucide-react";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";
import { StreamQuality } from "@/utils/manifestParser";

interface PlayerSettingsProps {
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
  quality: string;
  onQualityChange: (quality: string) => void;
  isVisible: boolean;
  onClose: () => void;
  availableQualities?: StreamQuality[];
}

export const PlayerSettings = ({ 
  playbackRate, 
  onPlaybackRateChange,
  quality,
  onQualityChange,
  isVisible,
  onClose,
  availableQualities = []
}: PlayerSettingsProps) => {
  if (!isVisible) return null;

  const hasMultipleQualities = availableQualities.length > 0;

  return (
    <div className="absolute top-4 left-4 bg-black/90 backdrop-blur-xl border border-primary/40 rounded-xl p-4 space-y-4 w-64 shadow-2xl z-30 animate-in fade-in slide-in-from-left-2 duration-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-primary font-bold">
          <Settings className="w-4 h-4" />
          <span className="text-sm">Paramètres</span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClose}
          className="h-6 w-6 text-white/60 hover:text-white hover:bg-white/10"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
      
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-white/80 text-xs flex items-center gap-1.5 font-semibold">
            <Zap className="w-3.5 h-3.5 text-primary" />
            Vitesse de lecture
          </Label>
          <Select 
            value={playbackRate.toString()} 
            onValueChange={(v) => onPlaybackRateChange(parseFloat(v))}
          >
            <SelectTrigger className="bg-white/10 border-white/20 text-white h-9 text-sm hover:bg-white/15 transition-colors">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="0.5">0.5x - Ralenti</SelectItem>
              <SelectItem value="0.75">0.75x - Lent</SelectItem>
              <SelectItem value="1">1x - Normal</SelectItem>
              <SelectItem value="1.25">1.25x - Rapide</SelectItem>
              <SelectItem value="1.5">1.5x - Très rapide</SelectItem>
              <SelectItem value="2">2x - Turbo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <Label className="text-white/80 text-xs flex items-center gap-1.5 font-semibold">
            <Gauge className="w-3.5 h-3.5 text-primary" />
            Qualité du flux
          </Label>
          <Select value={quality} onValueChange={onQualityChange}>
            <SelectTrigger className="bg-white/10 border-white/20 text-white h-9 text-sm hover:bg-white/15 transition-colors">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="auto">⚡ Auto (Adaptatif)</SelectItem>
              {hasMultipleQualities ? (
                <>
                  {availableQualities.map(q => (
                    <SelectItem key={q.id} value={q.label.toLowerCase()}>
                      {q.label} - {(q.bandwidth / 1000000).toFixed(1)} Mbps
                    </SelectItem>
                  ))}
                </>
              ) : (
                <>
                  <SelectItem value="high">🎯 Haute - FHD</SelectItem>
                  <SelectItem value="medium">📺 Moyenne - HD</SelectItem>
                  <SelectItem value="low">💾 Basse - SD</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
          {hasMultipleQualities && (
            <p className="text-[10px] text-green-400">
              ✓ {availableQualities.length} qualités HLS détectées
            </p>
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-white/10">
        <div className="text-[10px] text-white/50 space-y-1">
          <p>💡 Auto s'adapte à votre connexion en temps réel</p>
          <p>⚡ Vitesse 2x pour rattrapage rapide</p>
          {hasMultipleQualities && (
            <p>📊 Mesure du débit réel activée</p>
          )}
        </div>
      </div>
    </div>
  );
};
