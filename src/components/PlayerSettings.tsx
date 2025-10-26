import { Settings, Zap, Gauge } from "lucide-react";
import { Card } from "./ui/card";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

interface PlayerSettingsProps {
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
  quality: string;
  onQualityChange: (quality: string) => void;
}

export const PlayerSettings = ({ 
  playbackRate, 
  onPlaybackRateChange,
  quality,
  onQualityChange 
}: PlayerSettingsProps) => {
  return (
    <Card className="absolute top-4 left-4 bg-black/80 backdrop-blur-sm border-primary/30 p-4 space-y-4 w-64 z-30">
      <div className="flex items-center gap-2 text-primary font-semibold">
        <Settings className="w-4 h-4" />
        <span>Paramètres</span>
      </div>
      
      <div className="space-y-3">
        <div className="space-y-2">
          <Label className="text-white/80 text-xs flex items-center gap-1.5">
            <Zap className="w-3 h-3" />
            Vitesse
          </Label>
          <Select 
            value={playbackRate.toString()} 
            onValueChange={(v) => onPlaybackRateChange(parseFloat(v))}
          >
            <SelectTrigger className="bg-input/50 border-border text-white h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="0.5">0.5x (Lent)</SelectItem>
              <SelectItem value="0.75">0.75x</SelectItem>
              <SelectItem value="1">1x (Normal)</SelectItem>
              <SelectItem value="1.25">1.25x</SelectItem>
              <SelectItem value="1.5">1.5x</SelectItem>
              <SelectItem value="2">2x (Rapide)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <Label className="text-white/80 text-xs flex items-center gap-1.5">
            <Gauge className="w-3 h-3" />
            Qualité
          </Label>
          <Select value={quality} onValueChange={onQualityChange}>
            <SelectTrigger className="bg-input/50 border-border text-white h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="auto">Auto (Recommandé)</SelectItem>
              <SelectItem value="high">Haute (FHD)</SelectItem>
              <SelectItem value="medium">Moyenne (HD)</SelectItem>
              <SelectItem value="low">Basse (SD)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </Card>
  );
};
