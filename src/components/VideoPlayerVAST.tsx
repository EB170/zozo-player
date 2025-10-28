import { useEffect, useRef, useState } from "react";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import { toast } from "sonner";
import { VASTClient, VASTTracker } from '@dailymotion/vast-client';

interface VideoPlayerVASTProps {
  streamUrl: string;
  vastUrl: string;
  autoPlay?: boolean;
}

export const VideoPlayerVAST = ({ 
  streamUrl, 
  vastUrl,
  autoPlay = true 
}: VideoPlayerVASTProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);
  const vastClientRef = useRef<VASTClient>(new VASTClient());
  const vastTrackerRef = useRef<VASTTracker | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasPlayedAdRef = useRef(false);

  const [isAdPlaying, setIsAdPlaying] = useState(false);
  const [adTimeRemaining, setAdTimeRemaining] = useState(0);
  const [canSkipAd, setCanSkipAd] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);

  // Détection iOS/Safari pour autoplay
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  // Tracker interaction utilisateur (crucial pour iOS)
  useEffect(() => {
    const handleInteraction = () => {
      setUserInteracted(true);
    };

    document.addEventListener('click', handleInteraction, { once: true });
    document.addEventListener('touchstart', handleInteraction, { once: true });

    return () => {
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('touchstart', handleInteraction);
    };
  }, []);

  // Fonction pour jouer une pub VAST
  const playVASTAd = async (): Promise<boolean> => {
    console.log('🎬 [VAST] Tentative de lecture publicité...');
    
    if (!videoRef.current) {
      console.error('❌ [VAST] Aucun élément vidéo trouvé');
      return false;
    }

    try {
      setIsAdPlaying(true);
      
      // Parser le VAST
      const vastResponse = await vastClientRef.current.get(vastUrl);
      
      if (!vastResponse || !vastResponse.ads || vastResponse.ads.length === 0) {
        console.warn('⚠️ [VAST] Aucune publicité trouvée dans la réponse VAST');
        setIsAdPlaying(false);
        return false;
      }

      const ad = vastResponse.ads[0];
      const creative = ad.creatives.find((c: any) => c.type === 'linear');
      
      if (!creative) {
        console.warn('⚠️ [VAST] Aucun creative linear trouvé');
        setIsAdPlaying(false);
        return false;
      }

      // Sélectionner la meilleure mediaFile (MP4 prioritaire pour iOS)
      const mediaFiles = creative.mediaFiles || [];
      let selectedMedia = mediaFiles.find((m: any) => m.mimeType === 'video/mp4');
      if (!selectedMedia) {
        selectedMedia = mediaFiles[0]; // Fallback sur le premier disponible
      }

      if (!selectedMedia) {
        console.warn('⚠️ [VAST] Aucun mediaFile trouvé');
        setIsAdPlaying(false);
        return false;
      }

      console.log('✅ [VAST] Publicité trouvée:', selectedMedia.fileURL);

      // Créer un tracker VAST pour les impressions/events
      vastTrackerRef.current = new VASTTracker(vastClientRef.current, ad, creative);

      // Détruire le player existant si présent
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }

      const video = videoRef.current;
      
      // Configuration spéciale pour iOS/Safari
      if (isIOS || isSafari) {
        video.muted = !userInteracted; // Mute si pas d'interaction
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');
      }

      // Charger la pub
      video.src = selectedMedia.fileURL;
      video.load();

      const adDuration = creative.duration || 0;
      const skipDelay = creative.skipDelay || 5;
      setAdTimeRemaining(adDuration);

      // Gérer le countdown et skip
      let countdownInterval: NodeJS.Timeout | null = null;
      let skipTimeout: NodeJS.Timeout | null = null;

      const startCountdown = () => {
        let remaining = adDuration;
        setAdTimeRemaining(remaining);

        countdownInterval = setInterval(() => {
          remaining -= 1;
          setAdTimeRemaining(Math.max(0, remaining));
          
          if (remaining <= 0 && countdownInterval) {
            clearInterval(countdownInterval);
          }
        }, 1000);

        // Activer skip après delay
        if (skipDelay > 0) {
          skipTimeout = setTimeout(() => {
            setCanSkipAd(true);
            console.log('✅ [VAST] Skip disponible');
          }, skipDelay * 1000);
        }
      };

      // Event handlers
      const onAdPlaying = () => {
        console.log('▶️ [VAST] Publicité en cours de lecture');
        vastTrackerRef.current?.trackImpression();
        startCountdown();
      };

      const onAdEnded = () => {
        console.log('✅ [VAST] Publicité terminée');
        vastTrackerRef.current?.complete();
        
        if (countdownInterval) clearInterval(countdownInterval);
        if (skipTimeout) clearTimeout(skipTimeout);
        
        setIsAdPlaying(false);
        setCanSkipAd(false);
        setAdTimeRemaining(0);
        
        // Initialiser le flux principal
        initMainPlayer();
      };

      const onAdError = (e: any) => {
        console.error('❌ [VAST] Erreur publicité:', e);
        vastTrackerRef.current?.errorWithCode('VAST_LINEAR_ASSET_MISMATCH');
        
        if (countdownInterval) clearInterval(countdownInterval);
        if (skipTimeout) clearTimeout(skipTimeout);
        
        setIsAdPlaying(false);
        setCanSkipAd(false);
        
        // Fallback vers le contenu principal
        toast.error('Publicité non disponible', {
          description: 'Passage direct au contenu'
        });
        initMainPlayer();
      };

      video.addEventListener('playing', onAdPlaying);
      video.addEventListener('ended', onAdEnded);
      video.addEventListener('error', onAdError);

      // Tenter de lancer la pub
      try {
        await video.play();
        console.log('✅ [VAST] Lecture publicité réussie');
        
        // Track impression
        vastTrackerRef.current?.trackImpression();
        
        return true;
      } catch (playError: any) {
        console.warn('⚠️ [VAST] Autoplay bloqué, tentative muted...', playError);
        
        // iOS/Safari: tentative avec muted
        if (isIOS || isSafari) {
          video.muted = true;
          try {
            await video.play();
            console.log('✅ [VAST] Lecture publicité réussie (muted)');
            toast('Publicité en sourdine', {
              description: 'Cliquez pour activer le son'
            });
            return true;
          } catch (mutedError) {
            console.error('❌ [VAST] Échec lecture même muted:', mutedError);
            onAdError(mutedError);
            return false;
          }
        } else {
          onAdError(playError);
          return false;
        }
      }

    } catch (error) {
      console.error('❌ [VAST] Erreur parsing VAST:', error);
      toast.error('Publicité non disponible');
      setIsAdPlaying(false);
      return false;
    }
  };

  // Fonction pour skip la pub
  const skipAd = () => {
    if (!canSkipAd) return;
    
    console.log('⏭️ [VAST] Skip publicité demandé');
    vastTrackerRef.current?.skip();
    
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
    }
    
    setIsAdPlaying(false);
    setCanSkipAd(false);
    setAdTimeRemaining(0);
    
    // Lancer le contenu principal
    initMainPlayer();
  };

  // Initialiser le player principal (après pub)
  const initMainPlayer = () => {
    if (!videoRef.current) return;

    console.log('🎬 [Player] Initialisation player principal...');

    // Détruire ancien player si existe
    if (playerRef.current) {
      playerRef.current.dispose();
      playerRef.current = null;
    }

    // Créer le player Video.js
    const player = videojs(videoRef.current, {
      controls: true,
      autoplay: autoPlay,
      preload: 'auto',
      fluid: true,
      responsive: true,
      playbackRates: [0.5, 1, 1.25, 1.5, 2],
      html5: {
        vhs: {
          // Configuration HLS optimisée pour stabilité
          enableLowInitialPlaylist: true,
          smoothQualityChange: true,
          overrideNative: true,
          // Buffer settings pour zéro coupure
          maxBufferLength: 60,
          maxMaxBufferLength: 90,
          // ABR adaptatif
          bandwidth: 1000000, // 1 Mbps par défaut
          limitRenditionByPlayerDimensions: true
        },
        nativeAudioTracks: false,
        nativeVideoTracks: false
      },
      sources: [{
        src: streamUrl,
        type: streamUrl.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp2t'
      }]
    });

    playerRef.current = player;

    // Events
    player.on('ready', () => {
      console.log('✅ [Player] Player prêt');
      toast.success('🎬 Lecture démarrée', {
        duration: 2000
      });
    });

    player.on('error', (e: any) => {
      const error = player.error();
      console.error('❌ [Player] Erreur:', error);
      
      toast.error('Erreur de lecture', {
        description: 'Tentative de reconnexion...'
      });

      // Retry automatique après 3s
      setTimeout(() => {
        player.src({ src: streamUrl, type: streamUrl.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp2t' });
        player.load();
        player.play().catch(() => {});
      }, 3000);
    });

    // Autoplay si demandé
    if (autoPlay) {
      player.play().catch((err) => {
        console.warn('⚠️ [Player] Autoplay bloqué:', err);
        toast('Cliquez pour démarrer la lecture', {
          description: 'Autoplay bloqué par le navigateur'
        });
      });
    }
  };

  // Effect principal : démarrer la séquence pub → contenu
  useEffect(() => {
    if (!videoRef.current || hasPlayedAdRef.current) return;

    hasPlayedAdRef.current = true;

    // Attendre un peu pour que tout soit prêt
    const initTimeout = setTimeout(async () => {
      console.log('🚀 [Init] Démarrage séquence pub → contenu');
      
      // Tenter de jouer la pub
      const adPlayed = await playVASTAd();
      
      // Si pub échoue, lancer directement le contenu
      if (!adPlayed) {
        console.log('⚠️ [Init] Pub échouée, lancement contenu direct');
        initMainPlayer();
      }
    }, 500);

    return () => {
      clearTimeout(initTimeout);
      
      // Cleanup
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
      
      if (vastTrackerRef.current) {
        vastTrackerRef.current = null;
      }
    };
  }, [streamUrl]); // Re-trigger à chaque changement de streamUrl

  // Reset hasPlayedAd quand streamUrl change (nouveau zapping)
  useEffect(() => {
    hasPlayedAdRef.current = false;
  }, [streamUrl]);

  return (
    <div ref={containerRef} className="relative w-full max-w-6xl mx-auto bg-[hsl(var(--player-bg))] rounded-lg overflow-hidden shadow-[var(--shadow-elevated)]">
      {/* Video Element */}
      <div data-vjs-player className="relative">
        <video
          ref={videoRef}
          className="video-js vjs-default-skin vjs-big-play-centered w-full"
          playsInline
          webkit-playsinline="true"
          x-webkit-airplay="allow"
        />
      </div>

      {/* Overlay Publicité */}
      {isAdPlaying && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50 pointer-events-none">
          <div className="text-center space-y-4 pointer-events-none">
            <div className="text-foreground text-sm font-medium px-4 py-2 bg-primary/20 rounded-full backdrop-blur-sm">
              Publicité
            </div>
            
            {adTimeRemaining > 0 && (
              <div className="text-muted-foreground text-xs">
                {adTimeRemaining}s restantes
              </div>
            )}

            {canSkipAd && (
              <button
                onClick={skipAd}
                className="mt-4 px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-all pointer-events-auto shadow-lg hover:shadow-[var(--shadow-glow)]"
              >
                ⏭️ Passer la publicité
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
