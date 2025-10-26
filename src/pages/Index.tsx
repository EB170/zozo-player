import { useState } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Video, Tv } from "lucide-react";
const PREDEFINED_CHANNELS = [{
  name: "Eurosport 1 FHD",
  url: "http://drmv3-m6.info:80/play/live.php?mac=00:1A:79:84:1A:60&stream=250665&extension=ts"
}, {
  name: "Eurosport 2 FHD",
  url: "http://drmv3-m6.info:80/play/live.php?mac=00:1A:79:84:1A:60&stream=250664&extension=ts"
}, {
  name: "Ligue 1+ FHD",
  url: "http://drmv3-m6.info:80/play/live.php?mac=00:1A:79:84:1A:60&stream=1523608&extension=ts"
}, {
  name: "Ligue 1+ 2 FHD",
  url: "http://drmv3-m6.info:80/play/live.php?mac=00:1A:79:84:1A:60&stream=1567322&extension=ts"
}, {
  name: "Ligue 1+ 3 FHD",
  url: "http://drmv3-m6.info:80/play/live.php?mac=00:1A:79:84:1A:60&stream=1567324&extension=ts"
}, {
  name: "Ligue 1+ 4 FHD",
  url: "http://drmv3-m6.info:80/play/live.php?mac=00:1A:79:84:1A:60&stream=1567325&extension=ts"
}, {
  name: "RMC Sport 1 FHD",
  url: "http://eagle2024.xyz:80/play/live.php?mac=00:1A:79:84:0F:1B&stream=/play/live.php?mac=00:1A:79:BF:47:35&stream=32835&extension=ts"
}, {
  name: "Canal+ FHD",
  url: "http://drmv3-m6.info:80/play/live.php?mac=00:1A:79:84:1A:60&stream=148474&extension=ts"
}, {
  name: "Canal+ Foot FHD",
  url: "http://drmv3-m6.info:80/play/live.php?mac=00:1A:79:84:1A:60&stream=/play/live.php?mac=00:1A:79:CD:E0:3F&stream=256629&extension=ts"
}, {
  name: "Canal+ Sport 360 FHD",
  url: "http://eagle2024.xyz:80/play/live.php?mac=00:1A:79:CD:E0:3F&stream=256628&extension=ts"
}, {
  name: "Canal+ Sport FHD",
  url: "http://eagle2024.xyz:80/play/live.php?mac=00:1A:79:BF:47:35&stream=250679&extension=ts"
}];
const Index = () => {
  const [streamUrl, setStreamUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [selectedChannel, setSelectedChannel] = useState("");
  const handleLoadStream = () => {
    if (!urlInput.trim()) {
      toast.error("Veuillez entrer une URL de flux");
      return;
    }

    // Basic URL validation
    try {
      new URL(urlInput);
      setActiveUrl(urlInput);
      setStreamUrl(urlInput);
      toast.success("Flux chargé avec succès");
    } catch {
      toast.error("URL invalide");
    }
  };
  const handleChannelSelect = (channelName: string) => {
    const channel = PREDEFINED_CHANNELS.find(ch => ch.name === channelName);
    if (channel) {
      setSelectedChannel(channelName);
      setUrlInput(channel.url);
      setActiveUrl(channel.url);
      setStreamUrl(channel.url);
      toast.success(`Chargement de ${channel.name}`);
    }
  };
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleLoadStream();
    }
  };
  return <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3 mb-2">
            
            
          </div>
          
        </div>

        {/* Channel Selection & URL Input Card */}
        <Card className="p-6 bg-card border-border shadow-[var(--shadow-elevated)]">
          <div className="space-y-4">
            {/* Predefined Channels Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Tv className="w-4 h-4 text-primary" />
                Chaînes prédéfinies
              </label>
              <Select value={selectedChannel} onValueChange={handleChannelSelect}>
                <SelectTrigger className="w-full bg-input border-border">
                  <SelectValue placeholder="Sélectionner une chaîne..." />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border max-h-[300px]">
                  {PREDEFINED_CHANNELS.map(channel => <SelectItem key={channel.name} value={channel.name} className="cursor-pointer">
                      {channel.name}
                    </SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Custom URL Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Ou entrez une URL personnalisée
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <Input type="text" placeholder="https://exemple.com/stream.m3u8 ou .ts" value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyPress={handleKeyPress} className="flex-1 bg-input border-border text-foreground placeholder:text-muted-foreground" />
                <Button onClick={handleLoadStream} className="bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-opacity shadow-lg">
                  Charger le flux
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Formats supportés : HLS (.m3u8), MPEG-TS (.ts) • Lecture live 24/7 • Auto-reconnexion
            </p>
          </div>
        </Card>

        {/* Video Player */}
        {streamUrl ? <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <VideoPlayer streamUrl={streamUrl} autoPlay />
          </div> : <Card className="p-12 bg-card border-border border-dashed">
            <div className="text-center space-y-3">
              <div className="inline-flex p-4 rounded-full bg-secondary">
                <Video className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold">Aucun flux actif</h3>
              <p className="text-muted-foreground">
                Entrez l'URL d'un flux TS ou HLS ci-dessus pour commencer la lecture
              </p>
            </div>
          </Card>}

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-6 bg-card border-border hover:border-primary/50 transition-colors">
            <h3 className="font-semibold mb-2 text-primary">⚡ Zéro coupure</h3>
            <p className="text-sm text-muted-foreground">
              Reconnexion automatique en cas de problème réseau ou de flux
            </p>
          </Card>
          <Card className="p-6 bg-card border-border hover:border-primary/50 transition-colors">
            <h3 className="font-semibold mb-2 text-accent">🎯 Latence minimale</h3>
            <p className="text-sm text-muted-foreground">
              Buffer optimisé pour une lecture en direct avec le minimum de retard
            </p>
          </Card>
          <Card className="p-6 bg-card border-border hover:border-primary/50 transition-colors">
            <h3 className="font-semibold mb-2 text-[hsl(var(--success))]">🔄 24/7 Live</h3>
            <p className="text-sm text-muted-foreground">
              Conçu pour la lecture continue de flux en direct sans interruption
            </p>
          </Card>
        </div>
      </div>
    </div>;
};
export default Index;