import { useState } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Video } from "lucide-react";

const Index = () => {
  const [streamUrl, setStreamUrl] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [urlInput, setUrlInput] = useState("");

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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleLoadStream();
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3 mb-2">
            <div className="p-3 rounded-xl bg-gradient-to-br from-primary to-accent shadow-[var(--shadow-glow)]">
              <Video className="w-8 h-8 text-primary-foreground" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              Live Stream Player
            </h1>
          </div>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Player haute qualité pour flux TS et HLS avec reconnexion automatique et latence minimale
          </p>
        </div>

        {/* URL Input Card */}
        <Card className="p-6 bg-card border-border shadow-[var(--shadow-elevated)]">
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                type="text"
                placeholder="https://exemple.com/stream.m3u8 ou .ts"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyPress={handleKeyPress}
                className="flex-1 bg-input border-border text-foreground placeholder:text-muted-foreground"
              />
              <Button
                onClick={handleLoadStream}
                className="bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-opacity shadow-lg"
              >
                Charger le flux
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Formats supportés : HLS (.m3u8), MPEG-TS (.ts) • Lecture live 24/7 • Auto-reconnexion
            </p>
          </div>
        </Card>

        {/* Video Player */}
        {streamUrl ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <VideoPlayer streamUrl={streamUrl} autoPlay />
          </div>
        ) : (
          <Card className="p-12 bg-card border-border border-dashed">
            <div className="text-center space-y-3">
              <div className="inline-flex p-4 rounded-full bg-secondary">
                <Video className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold">Aucun flux actif</h3>
              <p className="text-muted-foreground">
                Entrez l'URL d'un flux TS ou HLS ci-dessus pour commencer la lecture
              </p>
            </div>
          </Card>
        )}

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
    </div>
  );
};

export default Index;
