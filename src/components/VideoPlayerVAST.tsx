import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import mpegts from "mpegts.js";
import { toast } from "sonner";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsPlayerRef = useRef<mpegts.Player | null>(null);
  const hasPlayedAdRef = useRef(false);
  const imaContainerRef = useRef<HTMLDivElement>(null);
  const adsManagerRef = useRef<any>(null);
  const adsLoaderRef = useRef<any>(null);

  const [isAdPlaying, setIsAdPlaying] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);

  // Détection iOS/Safari
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  // Tracker interaction utilisateur
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

  // Charger le SDK IMA de Google
  useEffect(() => {
    const loadIMAScript = () => {
      return new Promise<void>((resolve, reject) => {
        if ((window as any).google?.ima) {
          resolve();
          return;
        }

        const script = document.createElement('script');
        script.src = 'https://imasdk.googleapis.com/js/sdkloader/ima3.js';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Échec chargement IMA SDK'));
        document.head.appendChild(script);
      });
    };

    loadIMAScript().catch((err) => {
      console.error('❌ [IMA] Erreur chargement SDK:', err);
    });
  }, []);

  // Fonction pour jouer une pub IMA
  const playIMAd = async (): Promise<boolean> => {
    console.log('🎬 [IMA] Tentative de lecture publicité...');

    if (!videoRef.current || !imaContainerRef.current) {
      console.error('❌ [IMA] Éléments manquants');
      return false;
    }

    const ima = (window as any).google?.ima;
    if (!ima) {
      console.error('❌ [IMA] SDK non chargé');
      return false;
    }

    try {
      setIsAdPlaying(true);

      // Créer le display container
      const adDisplayContainer = new ima.AdDisplayContainer(
        imaContainerRef.current,
        videoRef.current
      );

      // Initialiser APRÈS interaction utilisateur
      if (userInteracted || !isIOS) {
        adDisplayContainer.initialize();
      }

      // Créer le loader
      const adsLoader = new ima.AdsLoader(adDisplayContainer);
      adsLoaderRef.current = adsLoader;

      // Écouter les erreurs
      adsLoader.addEventListener(
        ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
        (event: any) => onAdsManagerLoaded(event, adDisplayContainer),
        false
      );

      adsLoader.addEventListener(
        ima.AdErrorEvent.Type.AD_ERROR,
        onAdError,
        false
      );

      // Requête VAST
      const adsRequest = new ima.AdsRequest();
      adsRequest.adTagUrl = vastUrl;
      adsRequest.linearAdSlotWidth = videoRef.current.clientWidth;
      adsRequest.linearAdSlotHeight = videoRef.current.clientHeight;
      adsRequest.nonLinearAdSlotWidth = videoRef.current.clientWidth;
      adsRequest.nonLinearAdSlotHeight = videoRef.current.clientHeight / 3;

      // Demander les pubs
      adsLoader.requestAds(adsRequest);

      return true;
    } catch (error) {
      console.error('❌ [IMA] Erreur:', error);
      setIsAdPlaying(false);
      return false;
    }
  };

  // Callback quand le manager est chargé
  const onAdsManagerLoaded = (adsManagerLoadedEvent: any, adDisplayContainer: any) => {
    const ima = (window as any).google.ima;
    const adsManager = adsManagerLoadedEvent.getAdsManager(videoRef.current);
    adsManagerRef.current = adsManager;

    // Événements du manager
    adsManager.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, onAdError);
    adsManager.addEventListener(ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED, () => {
      console.log('⏸️ [IMA] Pause contenu pour pub');
      setIsAdPlaying(true);
      if (videoRef.current) {
        videoRef.current.pause();
      }
    });

    adsManager.addEventListener(ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, () => {
      console.log('▶️ [IMA] Reprise contenu après pub');
      setIsAdPlaying(false);
      initMainPlayer();
    });

    adsManager.addEventListener(ima.AdEvent.Type.ALL_ADS_COMPLETED, () => {
      console.log('✅ [IMA] Toutes les pubs terminées');
      setIsAdPlaying(false);
      adsManager.destroy();
    });

    try {
      const viewMode = ima.ViewMode.NORMAL;
      adsManager.init(
        videoRef.current?.clientWidth || 640,
        videoRef.current?.clientHeight || 360,
        viewMode
      );
      adsManager.start();
      console.log('✅ [IMA] Pub lancée');
    } catch (adError) {
      console.error('❌ [IMA] Erreur démarrage pub:', adError);
      setIsAdPlaying(false);
      initMainPlayer();
    }
  };

  // Erreur pub
  const onAdError = (adErrorEvent: any) => {
    console.error('❌ [IMA] Erreur pub:', adErrorEvent.getError());
    setIsAdPlaying(false);
    if (adsManagerRef.current) {
      adsManagerRef.current.destroy();
    }
    toast.error('Publicité non disponible', {
      description: 'Passage direct au contenu'
    });
    initMainPlayer();
  };

  // Initialiser le player principal
  const initMainPlayer = () => {
    if (!videoRef.current || isPlayerReady) return;

    console.log('🎬 [Player] Initialisation player principal...');

    const video = videoRef.current;
    const isHLS = streamUrl.includes('.m3u8');

    // Nettoyer anciens players
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (mpegtsPlayerRef.current) {
      mpegtsPlayerRef.current.destroy();
      mpegtsPlayerRef.current = null;
    }

    if (isHLS) {
      // HLS avec HLS.js
      if (Hls.isSupported()) {
        const hls = new Hls({
          // Configuration stable pour IPTV
          lowLatencyMode: false,
          backBufferLength: 10,
          maxBufferLength: 60,
          maxMaxBufferLength: 90,
          maxBufferSize: 80 * 1000 * 1000,
          maxBufferHole: 0.3,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 6,
          maxLiveSyncPlaybackRate: 1.05,
          abrEwmaFastLive: 3.0,
          abrEwmaSlowLive: 9.0,
          abrEwmaDefaultEstimate: 1000000,
          abrBandWidthFactor: 0.85,
          abrBandWidthUpFactor: 0.70,
          enableWorker: true,
          debug: false
        });

        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log('✅ [HLS] Manifest parsé');
          setIsPlayerReady(true);
          if (autoPlay) {
            video.play().catch(() => {
              toast('Cliquez pour lancer la lecture');
            });
          }
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.error('❌ [HLS] Erreur fatale:', data);
            setTimeout(() => {
              hls.loadSource(streamUrl);
            }, 3000);
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari natif
        video.src = streamUrl;
        setIsPlayerReady(true);
        if (autoPlay) {
          video.play().catch(() => {
            toast('Cliquez pour lancer la lecture');
          });
        }
      }
    } else {
      // MPEG-TS avec mpegts.js
      if (mpegts.isSupported()) {
        const player = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: streamUrl
        }, {
          enableWorker: true,
          enableStashBuffer: true,
          stashInitialSize: 4 * 1024 * 1024,
          autoCleanupMaxBackwardDuration: 60,
          autoCleanupMinBackwardDuration: 30,
          lazyLoad: false,
          deferLoadAfterSourceOpen: false
        });

        player.attachMediaElement(video);
        player.load();
        mpegtsPlayerRef.current = player;

        player.on(mpegts.Events.ERROR, (err) => {
          console.error('❌ [MPEGTS] Erreur:', err);
          setTimeout(() => {
            player.unload();
            player.load();
          }, 3000);
        });

        setIsPlayerReady(true);
        if (autoPlay) {
          video.play().catch(() => {
            toast('Cliquez pour lancer la lecture');
          });
        }
      }
    }

    toast.success('🎬 Lecture démarrée');
  };

  // Séquence principale : pub → contenu
  useEffect(() => {
    if (!videoRef.current || hasPlayedAdRef.current) return;

    hasPlayedAdRef.current = true;

    const initTimeout = setTimeout(async () => {
      console.log('🚀 [Init] Séquence pub → contenu');

      // Si IMA disponible, tenter la pub
      if ((window as any).google?.ima) {
        const adPlayed = await playIMAd();
        if (!adPlayed) {
          initMainPlayer();
        }
      } else {
        // Pas de IMA, lancer direct
        initMainPlayer();
      }
    }, 500);

    return () => {
      clearTimeout(initTimeout);

      // Cleanup
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (mpegtsPlayerRef.current) {
        mpegtsPlayerRef.current.destroy();
        mpegtsPlayerRef.current = null;
      }
      if (adsManagerRef.current) {
        adsManagerRef.current.destroy();
        adsManagerRef.current = null;
      }
      if (adsLoaderRef.current) {
        adsLoaderRef.current.destroy();
        adsLoaderRef.current = null;
      }
    };
  }, [streamUrl]);

  // Reset à chaque changement de stream
  useEffect(() => {
    hasPlayedAdRef.current = false;
    setIsPlayerReady(false);
  }, [streamUrl]);

  return (
    <div ref={containerRef} className="relative w-full max-w-6xl mx-auto bg-[hsl(var(--player-bg))] rounded-lg overflow-hidden shadow-[var(--shadow-elevated)]">
      {/* Video Element */}
      <video
        ref={videoRef}
        className="w-full aspect-video bg-black"
        playsInline
        webkit-playsinline="true"
        controls={!isAdPlaying}
        x-webkit-airplay="allow"
      />

      {/* Container IMA (obligatoire pour les pubs) */}
      <div
        ref={imaContainerRef}
        className="absolute inset-0 pointer-events-none"
        style={{ display: isAdPlaying ? 'block' : 'none' }}
      />

      {/* Overlay publicité */}
      {isAdPlaying && (
        <div className="absolute top-4 left-4 z-50 px-4 py-2 bg-black/80 text-white text-sm font-medium rounded-full backdrop-blur-sm pointer-events-none">
          📺 Publicité en cours...
        </div>
      )}
    </div>
  );
};
