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
  const imaContainerRef = useRef<HTMLDivElement>(null);
  const adsManagerRef = useRef<any>(null);
  const adsLoaderRef = useRef<any>(null);
  const adDisplayContainerRef = useRef<any>(null);

  const [isAdPlaying, setIsAdPlaying] = useState(false);
  const [adSkippable, setAdSkippable] = useState(false);

  // Détection mobile
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  // Charger SDK IMA
  useEffect(() => {
    if ((window as any).google?.ima) return;

    const script = document.createElement('script');
    script.src = 'https://imasdk.googleapis.com/js/sdkloader/ima3.js';
    script.async = true;
    document.head.appendChild(script);
  }, []);

  // Initialiser le player de streaming
  const initStreamPlayer = () => {
    if (!videoRef.current) return;

    console.log('🎬 Initialisation stream:', streamUrl);
    const video = videoRef.current;
    const isHLS = streamUrl.includes('.m3u8');

    // Cleanup
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (mpegtsPlayerRef.current) {
      mpegtsPlayerRef.current.destroy();
      mpegtsPlayerRef.current = null;
    }

    if (isHLS) {
      // HLS
      if (Hls.isSupported()) {
        const hls = new Hls({
          lowLatencyMode: false,
          backBufferLength: 10,
          maxBufferLength: 60,
          maxMaxBufferLength: 90,
          maxBufferSize: 80 * 1000 * 1000,
          maxBufferHole: 0.5,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10,
          abrEwmaDefaultEstimate: 1000000,
          abrBandWidthFactor: 0.85,
          enableWorker: true,
          debug: false
        });

        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log('✅ HLS prêt');
          if (autoPlay) {
            video.play().catch(e => {
              console.log('⚠️ Autoplay bloqué, clic requis');
              toast('Cliquez pour lancer');
            });
          }
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.error('❌ Erreur HLS:', data.type);
            setTimeout(() => hls.loadSource(streamUrl), 3000);
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari natif
        video.src = streamUrl;
        if (autoPlay) {
          video.play().catch(() => toast('Cliquez pour lancer'));
        }
      }
    } else {
      // MPEG-TS
      if (mpegts.isSupported()) {
        const player = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: streamUrl
        }, {
          enableWorker: true,
          enableStashBuffer: true,
          stashInitialSize: 8 * 1024 * 1024,
          autoCleanupMaxBackwardDuration: 60,
          autoCleanupMinBackwardDuration: 30
        });

        player.attachMediaElement(video);
        player.load();
        mpegtsPlayerRef.current = player;

        player.on(mpegts.Events.ERROR, (err) => {
          console.error('❌ Erreur MPEGTS:', err);
          setTimeout(() => {
            player.unload();
            player.load();
          }, 3000);
        });

        if (autoPlay) {
          setTimeout(() => {
            video.play().catch(() => toast('Cliquez pour lancer'));
          }, 500);
        }
      }
    }
  };

  // Initialiser IMA et lancer pub
  const initAds = () => {
    const ima = (window as any).google?.ima;
    if (!ima || !videoRef.current || !imaContainerRef.current) {
      console.log('⚠️ IMA non disponible, passage au stream');
      initStreamPlayer();
      return;
    }

    console.log('🎬 Lancement pub VAST');
    const video = videoRef.current;

    try {
      // Display container
      adDisplayContainerRef.current = new ima.AdDisplayContainer(
        imaContainerRef.current,
        video
      );

      // Loader
      adsLoaderRef.current = new ima.AdsLoader(adDisplayContainerRef.current);

      adsLoaderRef.current.addEventListener(
        ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
        onAdsManagerLoaded,
        false
      );

      adsLoaderRef.current.addEventListener(
        ima.AdErrorEvent.Type.AD_ERROR,
        onAdError,
        false
      );

      // Request
      const adsRequest = new ima.AdsRequest();
      adsRequest.adTagUrl = vastUrl;
      adsRequest.linearAdSlotWidth = video.clientWidth || 640;
      adsRequest.linearAdSlotHeight = video.clientHeight || 360;

      // CRITIQUE pour mobile
      adsRequest.setAdWillAutoPlay(true);
      adsRequest.setAdWillPlayMuted(false);

      adsLoaderRef.current.requestAds(adsRequest);
    } catch (error) {
      console.error('❌ Erreur init IMA:', error);
      initStreamPlayer();
    }
  };

  const onAdsManagerLoaded = (event: any) => {
    const ima = (window as any).google.ima;
    const adsRenderingSettings = new ima.AdsRenderingSettings();
    adsRenderingSettings.restoreCustomPlaybackStateOnAdBreakComplete = true;

    adsManagerRef.current = event.getAdsManager(
      videoRef.current,
      adsRenderingSettings
    );

    const adsManager = adsManagerRef.current;

    // Events
    adsManager.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, onAdError);
    
    adsManager.addEventListener(ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED, () => {
      console.log('⏸️ Pause pour pub');
      setIsAdPlaying(true);
      if (videoRef.current) videoRef.current.pause();
    });

    adsManager.addEventListener(ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, () => {
      console.log('▶️ Reprise après pub');
      setIsAdPlaying(false);
      adsManager.destroy();
      initStreamPlayer();
    });

    adsManager.addEventListener(ima.AdEvent.Type.ALL_ADS_COMPLETED, () => {
      console.log('✅ Pubs terminées');
      setIsAdPlaying(false);
      adsManager.destroy();
      initStreamPlayer();
    });

    adsManager.addEventListener(ima.AdEvent.Type.STARTED, () => {
      console.log('📺 Pub démarrée');
    });

    adsManager.addEventListener(ima.AdEvent.Type.SKIPPABLE_STATE_CHANGED, () => {
      setAdSkippable(true);
    });

    try {
      // Initialiser display container (CRITIQUE pour mobile)
      adDisplayContainerRef.current.initialize();

      adsManager.init(
        videoRef.current?.clientWidth || 640,
        videoRef.current?.clientHeight || 360,
        ima.ViewMode.NORMAL
      );

      adsManager.start();
      console.log('✅ Pub lancée');
    } catch (error) {
      console.error('❌ Erreur démarrage pub:', error);
      onAdError();
    }
  };

  const onAdError = (adErrorEvent?: any) => {
    if (adErrorEvent) {
      console.error('❌ Erreur pub:', adErrorEvent.getError());
    }
    setIsAdPlaying(false);
    if (adsManagerRef.current) {
      adsManagerRef.current.destroy();
    }
    toast('Passage au contenu');
    initStreamPlayer();
  };

  // Démarrage initial
  useEffect(() => {
    const startTimeout = setTimeout(() => {
      if ((window as any).google?.ima) {
        initAds();
      } else {
        // Retry après chargement SDK
        const checkIMA = setInterval(() => {
          if ((window as any).google?.ima) {
            clearInterval(checkIMA);
            initAds();
          }
        }, 200);

        setTimeout(() => {
          clearInterval(checkIMA);
          initStreamPlayer();
        }, 3000);
      }
    }, 300);

    return () => {
      clearTimeout(startTimeout);
      if (hlsRef.current) hlsRef.current.destroy();
      if (mpegtsPlayerRef.current) mpegtsPlayerRef.current.destroy();
      if (adsManagerRef.current) adsManagerRef.current.destroy();
      if (adsLoaderRef.current) adsLoaderRef.current.destroy();
    };
  }, [streamUrl]);

  return (
    <div 
      ref={containerRef} 
      className="relative w-full max-w-6xl mx-auto bg-black rounded-lg overflow-hidden shadow-2xl"
    >
      <video
        ref={videoRef}
        className="w-full aspect-video bg-black"
        playsInline
        controls={!isAdPlaying}
        muted={false}
      />

      {/* IMA Container */}
      <div
        ref={imaContainerRef}
        className="absolute inset-0"
        style={{ 
          display: isAdPlaying ? 'block' : 'none',
          pointerEvents: isAdPlaying ? 'auto' : 'none'
        }}
      />

      {/* Badge pub */}
      {isAdPlaying && (
        <div className="absolute top-4 right-4 px-3 py-1.5 bg-yellow-500 text-black text-xs font-bold rounded-full animate-pulse">
          📺 PUBLICITÉ
        </div>
      )}
    </div>
  );
}
