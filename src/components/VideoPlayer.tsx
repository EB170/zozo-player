import { useEffect, useRef, useState, useCallback } from "react";
import mpegts from "mpegts.js";
import Hls from "hls.js";
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2, PictureInPicture, BarChart3, Settings as SettingsIcon } from "lucide-react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { PlayerStats } from "./PlayerStats";
import { PlayerSettings } from "./PlayerSettings";
import { QualityIndicator } from "./QualityIndicator";
import { useBandwidthMonitor } from "@/hooks/useBandwidthMonitor";
import { useErrorRecovery } from "@/hooks/useErrorRecovery";
import { useVideoMetrics } from "@/hooks/useVideoMetrics";
import { useRealBandwidth } from "@/hooks/useRealBandwidth";
import { useHealthMonitor } from "@/hooks/useHealthMonitor";
import { useAdaptiveBitrate } from "@/hooks/useAdaptiveBitrate";
import { parseHLSManifest, recommendQuality, StreamQuality } from "@/utils/manifestParser";
import { toast } from "sonner";

interface VideoPlayerProps {
  streamUrl: string;
  autoPlay?: boolean;
}

const getProxiedUrl = (originalUrl: string): string => {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || "wxkvljkvqcamktlwfmfx";
  const proxyUrl = `https://${projectId}.supabase.co/functions/v1/stream-proxy`;
  return `${proxyUrl}?url=${encodeURIComponent(originalUrl)}`;
};

export const VideoPlayer = ({ streamUrl, autoPlay = true }: VideoPlayerProps) => {
  // Double buffer system pour seamless transitions + cleanup proper
  const video1Ref = useRef<HTMLVideoElement>(null);
  const video2Ref = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeVideoRef = useRef<1 | 2>(1);
  
  const mpegts1Ref = useRef<any>(null);
  const mpegts2Ref = useRef<any>(null);
  const hls1Ref = useRef<Hls | null>(null);
  const hls2Ref = useRef<Hls | null>(null);
  
  const switchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const healthCheckRef = useRef<NodeJS.Timeout | null>(null);
  const useProxyRef = useRef(false);
  const playerTypeRef = useRef<'mpegts' | 'hls'>('mpegts');
  const lastTimeRef = useRef(0);
  const stallCountRef = useRef(0);
  const networkSpeedRef = useRef<'fast' | 'medium' | 'slow'>('fast');
  const lastTapTimeRef = useRef(0);
  const lastTapSideRef = useRef<'left' | 'right' | null>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [bufferHealth, setBufferHealth] = useState(100);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [quality, setQuality] = useState('auto');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showSeekFeedback, setShowSeekFeedback] = useState<{direction: 'forward' | 'backward', show: boolean}>({direction: 'forward', show: false});
  const [availableQualities, setAvailableQualities] = useState<StreamQuality[]>([]);
  const [manifestUrl, setManifestUrl] = useState<string>('');

  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();

  // Hooks professionnels
  const bandwidthMetrics = useBandwidthMonitor();
  const realBandwidth = useRealBandwidth();
  const errorRecovery = useErrorRecovery();
  const activeVideo = activeVideoRef.current === 1 ? video1Ref.current : video2Ref.current;
  const videoMetrics = useVideoMetrics(activeVideo);
  const { health: healthStatus, reset: resetHealth } = useHealthMonitor(activeVideo);
  const { abrState } = useAdaptiveBitrate(
    availableQualities,
    realBandwidth.currentBitrate || bandwidthMetrics.currentBandwidth,
    videoMetrics.bufferLevel,
    healthStatus.score,
    { 
      enabled: quality === 'auto' && !errorRecovery.errorState.isRecovering, // Désactiver ABR pendant recovery
      switchThreshold: 3,
      minSwitchInterval: 10000,
      bufferTargetUp: 8,
      bufferTargetDown: 2,
    }
  );

  const getActiveVideo = () => {
    return activeVideoRef.current === 1 ? video1Ref.current : video2Ref.current;
  };

  const getNextVideo = () => {
    return activeVideoRef.current === 1 ? video2Ref.current : video1Ref.current;
  };

  const getNextPlayerRefs = () => {
    return activeVideoRef.current === 1 
      ? { mpegts: mpegts2Ref, hls: hls2Ref }
      : { mpegts: mpegts1Ref, hls: hls1Ref };
  };

  const cleanupPlayer = (mpegtsRef: React.MutableRefObject<any>, hlsRef: React.MutableRefObject<Hls | null>) => {
    if (mpegtsRef.current) {
      try {
        mpegtsRef.current.pause();
        mpegtsRef.current.unload();
        mpegtsRef.current.detachMediaElement();
        mpegtsRef.current.destroy();
      } catch (e) {
        console.warn('Cleanup mpegts error:', e);
      }
      mpegtsRef.current = null;
    }
    
    if (hlsRef.current) {
      try {
        hlsRef.current.stopLoad();
        hlsRef.current.destroy();
      } catch (e) {
        console.warn('Cleanup hls error:', e);
      }
      hlsRef.current = null;
    }
  };

  // Détection réseau adaptative
  const detectNetworkSpeed = useCallback(() => {
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    
    if (connection) {
      const effectiveType = connection.effectiveType;
      
      if (effectiveType === '4g' || effectiveType === '5g') {
        networkSpeedRef.current = 'fast';
      } else if (effectiveType === '3g') {
        networkSpeedRef.current = 'medium';
      } else {
        networkSpeedRef.current = 'slow';
      }
      
      console.log(`📶 Network: ${effectiveType} (${networkSpeedRef.current})`);
    }
  }, []);

  const cleanup = () => {
    if (switchTimerRef.current) {
      clearInterval(switchTimerRef.current);
      switchTimerRef.current = null;
    }
    
    if (healthCheckRef.current) {
      clearInterval(healthCheckRef.current);
      healthCheckRef.current = null;
    }
    
    cleanupPlayer(mpegts1Ref, hls1Ref);
    cleanupPlayer(mpegts2Ref, hls2Ref);
  };

  // ABR automatique - appliquer les changements de qualité avec reload effectif
  useEffect(() => {
    if (errorRecovery.errorState.isRecovering) {
      if (import.meta.env.DEV) {
        console.log('⏸️ ABR paused during recovery');
      }
      return;
    }
    
    if (abrState.currentQuality && quality === 'auto' && playerTypeRef.current === 'hls' && availableQualities.length > 0) {
      const targetQuality = availableQualities.find(q => 
        q.bandwidth === abrState.currentQuality?.bandwidth
      );
      
      if (targetQuality && targetQuality.url) {
        if (import.meta.env.DEV) {
          console.log(`🎬 ABR applying quality: ${targetQuality.label} (${targetQuality.url})`);
        }
        
        // Forcer le changement de qualité en recréant le player HLS avec nouvelle URL
        const activeVideo = getActiveVideo();
        if (activeVideo && !isTransitioning) {
          const currentTime = activeVideo.currentTime;
          const wasPlaying = !activeVideo.paused;
          
          // Cleanup ancien player
          const activeRefs = activeVideoRef.current === 1 
            ? { mpegts: mpegts1Ref, hls: hls1Ref }
            : { mpegts: mpegts2Ref, hls: hls2Ref };
          
          cleanupPlayer(activeRefs.mpegts, activeRefs.hls);
          
          // Créer nouveau player avec URL de la qualité cible
          const newHls = new Hls({
            debug: false,
            enableWorker: true,
            lowLatencyMode: networkSpeedRef.current === 'fast',
            maxBufferLength: 60,
          });
          
          newHls.loadSource(getProxiedUrl(targetQuality.url));
          newHls.attachMedia(activeVideo);
          
          activeRefs.hls.current = newHls;
          
          // Restaurer position et lecture
          activeVideo.currentTime = currentTime;
          if (wasPlaying) {
            playPromiseRef.current = activeVideo.play().catch(err => {
              if (err.name !== 'AbortError') {
                console.error('ABR play error:', err);
              }
            });
          }
          
          toast.info(`📊 Qualité adaptée: ${targetQuality.label}`, {
            description: abrState.adaptationReason,
            duration: 2000,
          });
        }
      }
    }
  }, [abrState.currentQuality, quality, isTransitioning, errorRecovery.errorState.isRecovering, availableQualities]);

  // Monitoring health et alertes
  useEffect(() => {
    if (healthStatus.level === 'critical' && healthStatus.issues.length > 0) {
      console.warn('🚨 Health critical:', healthStatus.issues);
      
      if (healthStatus.issues.includes('Buffer critique')) {
        toast.warning("Buffer critique", {
          description: "Adaptation de la qualité en cours...",
          duration: 3000,
        });
      }
    }
  }, [healthStatus.level, healthStatus.issues]);

  // Parser manifest HLS pour détecter qualités disponibles
  useEffect(() => {
    if (streamUrl.includes('.m3u8') && playerTypeRef.current === 'hls') {
      parseHLSManifest(streamUrl).then(qualities => {
        if (qualities.length > 0) {
          setAvailableQualities(qualities);
          setManifestUrl(streamUrl);
          console.log('📺 Qualités HLS détectées:', qualities.map(q => `${q.label} (${(q.bandwidth/1000000).toFixed(1)} Mbps)`));
          toast.success(`${qualities.length} qualités HLS disponibles`, {
            description: 'Adaptation automatique activée',
            duration: 2000,
          });
        }
      });
    } else {
      // Pour MPEG-TS, pas de qualités multiples (stream direct)
      setAvailableQualities([]);
    }
  }, [streamUrl]);

  // Auto quality selection basée sur real bandwidth + health
  useEffect(() => {
    if (quality === 'auto' && availableQualities.length > 0 && realBandwidth.averageBitrate > 0) {
      // L'ABR hook gère déjà la sélection automatique
      if (abrState.currentQuality) {
        console.log(`🎯 ABR active: ${abrState.currentQuality.label} (health: ${healthStatus.score})`);
      }
    }
  }, [quality, availableQualities, realBandwidth.averageBitrate, abrState.currentQuality, healthStatus.score]);

  // Adapter buffer selon bandwidth réel et qualité
  const getOptimalBufferSize = () => {
    const bandwidth = realBandwidth.averageBitrate || bandwidthMetrics.averageBandwidth || bandwidthMetrics.currentBandwidth;
    const speed = networkSpeedRef.current;
    
    let baseSize = 1024;
    
    // Adapter selon qualité demandée
    if (quality === 'high') baseSize = 1536;
    else if (quality === 'medium') baseSize = 1024;
    else if (quality === 'low') baseSize = 768;
    else {
      // Auto - adapter selon bandwidth RÉEL
      if (bandwidth > 10) baseSize = 2048;
      else if (bandwidth > 6) baseSize = 1536;
      else if (bandwidth > 3) baseSize = 1024;
      else baseSize = 768;
    }
    
    // Modifier selon vitesse réseau
    if (speed === 'slow') baseSize = Math.round(baseSize * 0.7);
    else if (speed === 'fast') baseSize = Math.round(baseSize * 1.2);
    
    console.log(`🔧 Buffer size: ${baseSize}KB (bandwidth: ${bandwidth.toFixed(2)} Mbps, quality: ${quality})`);
    return baseSize;
  };

  const createMpegtsPlayer = (videoElement: HTMLVideoElement) => {
    const url = useProxyRef.current ? getProxiedUrl(streamUrl) : streamUrl;
    
    const player = mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url: url,
      cors: true,
      withCredentials: false,
    }, {
      enableWorker: true,
      enableStashBuffer: true,
      stashInitialSize: getOptimalBufferSize(),
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 20,
      autoCleanupMinBackwardDuration: 8,
      liveBufferLatencyChasing: networkSpeedRef.current === 'fast',
      liveBufferLatencyMaxLatency: 5,
      liveBufferLatencyMinRemain: 1,
      fixAudioTimestampGap: true,
      lazyLoad: false,
    });

    player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: any) => {
      if (import.meta.env.DEV) {
        console.error('🔴 MPEGTS Error:', errorType, errorDetail);
      }
      errorRecovery.recordError(`MPEGTS: ${errorType}`);
      
      if (!useProxyRef.current && errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
        useProxyRef.current = true;
        if (import.meta.env.DEV) {
          console.log('🔄 Switching to proxy...');
        }
        toast.info("🔄 Basculement vers proxy");
        errorRecovery.attemptRecovery(() => initDoubleBuffer()).catch(err => {
          console.error('Failed to recover with proxy:', err);
        });
      } else if (useProxyRef.current && errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
        playerTypeRef.current = 'hls';
        if (import.meta.env.DEV) {
          console.log('🔄 Switching to HLS...');
        }
        toast.info("🔄 Basculement vers HLS");
        errorRecovery.attemptRecovery(() => initDoubleBuffer()).catch(err => {
          console.error('Failed to recover with HLS:', err);
          toast.error("❌ Échec du basculement");
        });
      }
    });

    player.attachMediaElement(videoElement);
    player.load();
    
    return player;
  };

  const createHlsPlayer = (videoElement: HTMLVideoElement) => {
    if (!Hls.isSupported()) return null;
    
    // Utiliser manifest URL si qualité spécifique sélectionnée, sinon URL de base
    let url = streamUrl;
    if (quality !== 'auto' && availableQualities.length > 0) {
      const selectedQuality = availableQualities.find(q => 
        (quality === 'high' && q.label.includes('1080p')) ||
        (quality === 'medium' && q.label.includes('720p')) ||
        (quality === 'low' && q.label.includes('480p'))
      );
      if (selectedQuality && selectedQuality.url) {
        url = selectedQuality.url;
        console.log(`🎬 HLS quality switch: ${selectedQuality.label}`);
      }
    }
    
    url = getProxiedUrl(url);
    
    const bufferLength = networkSpeedRef.current === 'fast' ? 60 : networkSpeedRef.current === 'medium' ? 40 : 30;
    
    const hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: networkSpeedRef.current === 'fast',
      backBufferLength: 20,
      maxBufferLength: bufferLength,
      maxBufferSize: 120 * 1000 * 1000,
      maxBufferHole: 0.5,
      highBufferWatchdogPeriod: 2,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 8,
      maxFragLookUpTolerance: 0.2,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 6,
      manifestLoadingTimeOut: 12000,
      fragLoadingTimeOut: 25000,
      manifestLoadingMaxRetry: 6,
      fragLoadingMaxRetry: 12,
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        if (import.meta.env.DEV) {
          console.error('🔴 HLS Fatal Error:', data.type, data.details);
        }
        errorRecovery.recordError(`HLS: ${data.type} - ${data.details}`);
        
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (import.meta.env.DEV) {
            console.log('🔄 Attempting HLS network recovery...');
          }
          errorRecovery.attemptRecovery(() => {
            hls.startLoad();
          }).catch(err => console.error('HLS network recovery failed:', err));
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (import.meta.env.DEV) {
            console.log('🔄 Attempting HLS media recovery...');
          }
          errorRecovery.attemptRecovery(() => {
            hls.recoverMediaError();
          }).catch(err => console.error('HLS media recovery failed:', err));
        } else {
          if (import.meta.env.DEV) {
            console.log('🔄 Switching back to MPEGTS...');
          }
          playerTypeRef.current = 'mpegts';
          errorRecovery.attemptRecovery(() => initDoubleBuffer()).catch(err => {
            console.error('Failed to switch to MPEGTS:', err);
          });
        }
      }
    });

    hls.loadSource(url);
    hls.attachMedia(videoElement);
    
    return hls;
  };

  const prepareVideo = (videoElement: HTMLVideoElement, refs: { mpegts: any, hls: any }) => {
    if (!videoElement) return;
    
    videoElement.volume = volume;
    videoElement.muted = isMuted;
    videoElement.playbackRate = playbackRate;
    
    if (playerTypeRef.current === 'mpegts') {
      const player = createMpegtsPlayer(videoElement);
      refs.mpegts.current = player;
    } else {
      const hls = createHlsPlayer(videoElement);
      refs.hls.current = hls;
    }
  };

  const switchToNext = useCallback(() => {
    const activeVideo = getActiveVideo();
    const nextVideo = getNextVideo();
    
    if (!activeVideo || !nextVideo || isTransitioning) return;
    
    setIsTransitioning(true);
    if (import.meta.env.DEV) {
      console.log(`🔄 Buffer switch: ${activeVideoRef.current} → ${activeVideoRef.current === 1 ? 2 : 1}`);
    }
    
    // Cleanup l'ancien player du next buffer avant de créer un nouveau
    const nextRefs = getNextPlayerRefs();
    cleanupPlayer(nextRefs.mpegts, nextRefs.hls);
    
    // Créer nouveau player
    prepareVideo(nextVideo, nextRefs);
    
    let checkTimeout: NodeJS.Timeout;
    const checkReady = setInterval(() => {
      if (nextVideo.readyState >= 2) {
        clearInterval(checkReady);
        clearTimeout(checkTimeout);
        
        nextVideo.currentTime = activeVideo.currentTime;
        nextVideo.playbackRate = playbackRate;
        playPromiseRef.current = nextVideo.play().then(() => {
          // Transition fluide
          activeVideo.style.opacity = '0';
          nextVideo.style.opacity = '1';
          nextVideo.style.zIndex = '3';
          activeVideo.style.zIndex = '1';
          
          setTimeout(() => {
            // Attendre la fin de la promise play avant de pause
            if (playPromiseRef.current) {
              playPromiseRef.current.then(() => {
                activeVideo.pause();
                playPromiseRef.current = null;
              }).catch(() => {
                activeVideo.pause();
                playPromiseRef.current = null;
              });
            } else {
              activeVideo.pause();
            }
            activeVideoRef.current = activeVideoRef.current === 1 ? 2 : 1;
            setIsTransitioning(false);
            errorRecovery.reset();
          }, 300);
        }).catch(err => {
          if (err.name !== 'AbortError') {
            console.error('Switch playback error:', err);
          }
          setIsTransitioning(false);
          playPromiseRef.current = null;
        });
      }
    }, 50);
    
    checkTimeout = setTimeout(() => {
      clearInterval(checkReady);
      setIsTransitioning(false);
      console.warn('Switch timeout - buffer not ready');
    }, 5000);
  }, [playbackRate, isTransitioning]);

  const initDoubleBuffer = useCallback(() => {
    if (!video1Ref.current || !video2Ref.current) return;
    
    if (import.meta.env.DEV) {
      console.log('🎬 Initializing double buffer...');
    }
    cleanup();
    setIsLoading(true);
    detectNetworkSpeed();
    
    const video1 = video1Ref.current;
    video1.style.opacity = '1';
    video1.style.zIndex = '3';
    prepareVideo(video1, { mpegts: mpegts1Ref, hls: hls1Ref });
    
    if (autoPlay) {
      const attemptPlay = () => {
        if (import.meta.env.DEV) {
          console.log('▶️ Attempting playback...');
        }
        playPromiseRef.current = video1.play().then(() => {
          setIsPlaying(true);
          setIsLoading(false);
          playPromiseRef.current = null;
          if (import.meta.env.DEV) {
            console.log('✅ Playback started successfully');
          }
          toast.success("✅ Lecture démarrée", {
            description: `${playerTypeRef.current.toUpperCase()} • ${networkSpeedRef.current}`,
            duration: 2000,
          });
          
          // Préparer video 2 après 3s
          setTimeout(() => {
            const video2 = video2Ref.current;
            if (video2) {
              if (import.meta.env.DEV) {
                console.log('🔄 Preparing backup buffer...');
              }
              video2.style.opacity = '0';
              video2.style.zIndex = '2';
              prepareVideo(video2, { mpegts: mpegts2Ref, hls: hls2Ref });
            }
          }, 3000);
        }).catch((err) => {
          playPromiseRef.current = null;
          if (err.name === 'AbortError') {
            if (import.meta.env.DEV) {
              console.warn('⚠️ Play interrupted (AbortError) - ignoring');
            }
            return;
          }
          console.error('❌ Playback failed:', err);
          
          if (errorRecovery.canRetry) {
            if (import.meta.env.DEV) {
              console.log('🔄 Retrying playback...');
            }
            errorRecovery.attemptRecovery(attemptPlay).catch((recErr) => {
              console.error('❌ Recovery failed completely:', recErr);
              setIsLoading(false);
              errorRecovery.forceStop();
              toast.error("❌ Échec de lecture", {
                description: "Impossible de lire le flux après plusieurs tentatives",
                duration: 5000,
              });
            });
          } else {
            console.error('❌ Max retries reached');
            setIsLoading(false);
            errorRecovery.forceStop();
            toast.error("❌ Échec de lecture après plusieurs tentatives");
          }
        });
      };
      
      // Delay initial pour laisser le player se préparer
      setTimeout(attemptPlay, 100);
    } else {
      setIsLoading(false);
    }
  }, [autoPlay, detectNetworkSpeed]);

  const startHealthMonitoring = useCallback(() => {
    if (healthCheckRef.current) clearInterval(healthCheckRef.current);
    
    lastTimeRef.current = Date.now();
    stallCountRef.current = 0;
    
    healthCheckRef.current = setInterval(() => {
      const activeVideo = getActiveVideo();
      if (!activeVideo || activeVideo.paused) return;
      
      const now = Date.now();
      const elapsed = now - lastTimeRef.current;
      
      // Calculer buffer health
      if (activeVideo.buffered.length > 0) {
        const buffered = activeVideo.buffered.end(0) - activeVideo.currentTime;
        const health = Math.min(100, Math.round((buffered / 6) * 100));
        setBufferHealth(health);
        
        // Alert si buffer critique
        if (health < 20 && stallCountRef.current === 0) {
          console.warn('⚠️ Buffer critique!');
          toast.warning("Buffer faible", {
            description: "Adaptation de la qualité...",
            duration: 2000,
          });
        }
      }
      
      // Détection stall avancée
      if (elapsed > 3000) {
        stallCountRef.current++;
        console.warn(`⚠️ Stall détecté (${stallCountRef.current})`);
        
        if (stallCountRef.current >= 2) {
          console.log('🔄 Auto-recovery activé');
          stallCountRef.current = 0;
          switchToNext();
        }
      } else {
        stallCountRef.current = 0;
      }
    }, 1000);
  }, [switchToNext]);

  const startAutoSwitch = useCallback(() => {
    if (switchTimerRef.current) clearInterval(switchTimerRef.current);
    
    // Adapter intervalle selon bandwidth RÉEL
    const bandwidth = realBandwidth.averageBitrate || bandwidthMetrics.averageBandwidth || bandwidthMetrics.currentBandwidth;
    let interval = 15000;
    
    if (bandwidth > 10) interval = 10000; // Connexion excellente
    else if (bandwidth > 5) interval = 15000; // Bonne connexion
    else if (bandwidth > 2) interval = 20000; // Connexion moyenne
    else interval = 30000; // Connexion faible
    
    if (import.meta.env.DEV) {
      console.log(`⏱️ Auto-switch interval: ${interval/1000}s (real bandwidth: ${bandwidth.toFixed(2)} Mbps)`);
    }
    
    switchTimerRef.current = setInterval(() => {
      if (!isTransitioning) {
        if (import.meta.env.DEV) {
          console.log(`🔄 Auto switch planifié (${interval/1000}s)`);
        }
        switchToNext();
      }
    }, interval);
  }, [switchToNext, isTransitioning, realBandwidth, bandwidthMetrics]);

  // Double-tap seek pour mobile
  const handleVideoClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeVideo) return;
    
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const side = clickX < rect.width / 2 ? 'left' : 'right';
    
    // Double-tap détecté (moins de 300ms)
    if (now - lastTapTimeRef.current < 300 && lastTapSideRef.current === side) {
      const seekAmount = side === 'left' ? -10 : 10;
      activeVideo.currentTime = Math.max(0, activeVideo.currentTime + seekAmount);
      
      setShowSeekFeedback({ direction: side === 'left' ? 'backward' : 'forward', show: true });
      toast.info(side === 'left' ? '⏪ -10s' : '⏩ +10s', { duration: 1000 });
      
      setTimeout(() => setShowSeekFeedback({ direction: 'forward', show: false }), 500);
      
      lastTapTimeRef.current = 0;
      lastTapSideRef.current = null;
    } else {
      lastTapTimeRef.current = now;
      lastTapSideRef.current = side;
    }
  };

  // Raccourcis clavier avancés
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const activeVideo = getActiveVideo();
      if (!activeVideo) return;

      switch(e.code) {
        case 'Space':
          e.preventDefault();
          handlePlayPause();
          break;
        case 'KeyF':
          handleFullscreen();
          break;
        case 'KeyM':
          handleMuteToggle();
          break;
        case 'KeyP':
          handlePiP();
          break;
        case 'KeyS':
          setShowStats(s => !s);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(v => {
            const newVol = Math.min(1, v + 0.1);
            toast.info(`🔊 Volume: ${Math.round(newVol * 100)}%`, { duration: 1000 });
            return newVol;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(v => {
            const newVol = Math.max(0, v - 0.1);
            toast.info(`🔉 Volume: ${Math.round(newVol * 100)}%`, { duration: 1000 });
            return newVol;
          });
          break;
        case 'ArrowLeft':
          e.preventDefault();
          activeVideo.currentTime = Math.max(0, activeVideo.currentTime - 10);
          toast.info('⏪ -10s', { duration: 1000 });
          break;
        case 'ArrowRight':
          e.preventDefault();
          activeVideo.currentTime = activeVideo.currentTime + 10;
          toast.info('⏩ +10s', { duration: 1000 });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []); // Fonctions stables qui utilisent des refs

  useEffect(() => {
    const video1 = video1Ref.current;
    const video2 = video2Ref.current;
    
    if (!video1 || !video2) return;

    const handleTimeUpdate = () => {
      lastTimeRef.current = Date.now();
    };

    const handlePlaying = () => {
      setIsPlaying(true);
      setIsLoading(false);
    };

    const handleWaiting = () => {
      setIsLoading(true);
    };

    [video1, video2].forEach(video => {
      video.addEventListener('timeupdate', handleTimeUpdate);
      video.addEventListener('playing', handlePlaying);
      video.addEventListener('waiting', handleWaiting);
    });

    return () => {
      [video1, video2].forEach(video => {
        video.removeEventListener('timeupdate', handleTimeUpdate);
        video.removeEventListener('playing', handlePlaying);
        video.removeEventListener('waiting', handleWaiting);
      });
    };
  }, []);

  useEffect(() => {
    if (!streamUrl) return;
    
    useProxyRef.current = false;
    playerTypeRef.current = 'mpegts';
    activeVideoRef.current = 1;
    errorRecovery.reset();
    
    initDoubleBuffer();
    startHealthMonitoring();
    startAutoSwitch();
    
    return () => cleanup();
  }, [streamUrl, quality]);

  useEffect(() => {
    [video1Ref.current, video2Ref.current].forEach(video => {
      if (video) {
        video.volume = volume;
      }
    });
  }, [volume]);

  useEffect(() => {
    [video1Ref.current, video2Ref.current].forEach(video => {
      if (video) {
        video.playbackRate = playbackRate;
      }
    });
  }, [playbackRate]);

  const handlePlayPause = () => {
    const activeVideo = getActiveVideo();
    if (!activeVideo) return;
    
    if (isPlaying) {
      // Attendre la fin de la play promise avant de pause
      if (playPromiseRef.current) {
        playPromiseRef.current.then(() => {
          activeVideo.pause();
          setIsPlaying(false);
          playPromiseRef.current = null;
        }).catch(() => {
          activeVideo.pause();
          setIsPlaying(false);
          playPromiseRef.current = null;
        });
      } else {
        activeVideo.pause();
        setIsPlaying(false);
      }
    } else {
      playPromiseRef.current = activeVideo.play().then(() => {
        setIsPlaying(true);
        playPromiseRef.current = null;
      }).catch(err => {
        playPromiseRef.current = null;
        if (err.name !== 'AbortError') {
          console.error('Play error:', err);
        }
      });
    }
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    
    if (newVolume > 0 && isMuted) {
      setIsMuted(false);
      [video1Ref.current, video2Ref.current].forEach(video => {
        if (video) video.muted = false;
      });
    }
  };

  const handleMuteToggle = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    
    [video1Ref.current, video2Ref.current].forEach(video => {
      if (video) video.muted = newMuted;
    });
  };

  const handleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  };

  const handlePiP = async () => {
    const activeVideo = getActiveVideo();
    if (!activeVideo) return;
    
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await activeVideo.requestPictureInPicture();
        toast.success("📺 Picture-in-Picture activé");
      }
    } catch (err) {
      toast.error("Picture-in-Picture non disponible");
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
    }
    hideControlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showSettings) {
        setShowControls(false);
      }
    }, 3000);
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-2xl"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && !showSettings && setShowControls(false)}
      onClick={handleVideoClick}
    >
      {/* Double buffer system */}
      <video
        ref={video1Ref}
        className="absolute inset-0 w-full h-full transition-opacity duration-300"
        style={{ opacity: 0, zIndex: 1 }}
        playsInline
        preload="auto"
      />
      
      <video
        ref={video2Ref}
        className="absolute inset-0 w-full h-full transition-opacity duration-300"
        style={{ opacity: 0, zIndex: 1 }}
        playsInline
        preload="auto"
      />

      {/* Quality indicator avec health status */}
      {!isLoading && videoMetrics.resolution !== 'N/A' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-30">
          <QualityIndicator
            resolution={videoMetrics.resolution}
            bitrate={videoMetrics.actualBitrate}
            bufferHealth={bufferHealth}
          />
          {abrState.isAdapting && (
            <div className="bg-yellow-500/90 backdrop-blur-xl border border-yellow-400/40 rounded-full px-3 py-1.5 flex items-center gap-1.5 shadow-2xl animate-pulse">
              <span className="text-xs font-bold text-black">⚡ ABR</span>
            </div>
          )}
          {healthStatus.level === 'critical' && (
            <div className="bg-red-500/90 backdrop-blur-xl border border-red-400/40 rounded-full px-3 py-1.5 flex items-center gap-1.5 shadow-2xl animate-pulse">
              <span className="text-xs font-bold text-white">⚠️ Critique</span>
            </div>
          )}
        </div>
      )}

      {/* Stats overlay */}
      <PlayerStats 
        videoElement={getActiveVideo()}
        playerType={playerTypeRef.current}
        useProxy={useProxyRef.current}
        bufferHealth={bufferHealth}
        isVisible={showStats}
        networkSpeed={networkSpeedRef.current}
        bandwidthMbps={bandwidthMetrics.currentBandwidth}
        bandwidthTrend={bandwidthMetrics.trend}
        realBitrate={realBandwidth.currentBitrate}
        healthStatus={healthStatus}
        abrState={abrState}
      />

      {/* Settings overlay */}
      <PlayerSettings
        playbackRate={playbackRate}
        onPlaybackRateChange={setPlaybackRate}
        quality={quality}
        onQualityChange={(newQuality) => {
          setQuality(newQuality);
          
          if (import.meta.env.DEV) {
            console.log(`🎬 Manual quality change to: ${newQuality}`);
          }
          
          // Si changement manuel vers une qualité spécifique, forcer le reload
          if (newQuality !== 'auto' && availableQualities.length > 0) {
            const targetQuality = availableQualities.find(q => {
              const label = q.label.toLowerCase();
              return (
                (newQuality === 'high' && label.includes('1080')) ||
                (newQuality === 'medium' && label.includes('720')) ||
                (newQuality === 'low' && label.includes('480'))
              );
            });
            
            if (targetQuality?.url && playerTypeRef.current === 'hls') {
              const activeVideo = getActiveVideo();
              if (activeVideo) {
                const currentTime = activeVideo.currentTime;
                const wasPlaying = !activeVideo.paused;
                
                // Cleanup et reload avec nouvelle qualité
                const activeRefs = activeVideoRef.current === 1 
                  ? { mpegts: mpegts1Ref, hls: hls1Ref }
                  : { mpegts: mpegts2Ref, hls: hls2Ref };
                
                cleanupPlayer(activeRefs.mpegts, activeRefs.hls);
                
                const newHls = new Hls({
                  debug: false,
                  enableWorker: true,
                  lowLatencyMode: true,
                  maxBufferLength: 60,
                });
                
                newHls.loadSource(getProxiedUrl(targetQuality.url));
                newHls.attachMedia(activeVideo);
                activeRefs.hls.current = newHls;
                
                activeVideo.currentTime = currentTime;
                if (wasPlaying) {
                  playPromiseRef.current = activeVideo.play().catch(err => {
                    if (err.name !== 'AbortError') {
                      console.error('Quality switch play error:', err);
                    }
                  });
                }
                
                toast.success(`✅ Qualité changée: ${targetQuality.label}`);
              }
            } else {
              toast.info(`Qualité: ${newQuality}`, {
                description: availableQualities.length > 0 ? 'Changement appliqué' : 'Mode adaptatif',
                duration: 2000,
              });
            }
          } else {
            toast.info(`Qualité: ${newQuality}`, {
              description: 'Adaptation automatique activée',
              duration: 2000,
            });
          }
        }}
        isVisible={showSettings}
        onClose={() => setShowSettings(false)}
        availableQualities={availableQualities}
      />

      {/* Seek feedback animation */}
      {showSeekFeedback.show && (
        <div className={`absolute top-1/2 ${showSeekFeedback.direction === 'backward' ? 'left-8' : 'right-8'} -translate-y-1/2 animate-in fade-in zoom-in duration-200`}>
          <div className="bg-black/80 backdrop-blur-xl rounded-full p-4">
            <span className="text-4xl">{showSeekFeedback.direction === 'backward' ? '⏪' : '⏩'}</span>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/95 backdrop-blur-sm z-10 animate-in fade-in duration-300">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <Loader2 className="w-16 h-16 text-primary animate-spin" />
              <div className="absolute inset-0 w-16 h-16 rounded-full bg-primary/20 animate-ping" />
            </div>
            <div className="text-center space-y-2 max-w-sm px-4">
              <div className="text-base text-white font-bold">
                {errorRecovery.errorState.isRecovering 
                  ? `🔄 Récupération (${errorRecovery.errorState.errorCount}/5)...` 
                  : 'Chargement du flux...'}
              </div>
              <div className="text-xs text-white/70 font-mono space-y-1">
                <div>{playerTypeRef.current.toUpperCase()} • {useProxyRef.current ? '🔒 Proxy' : '⚡ Direct'}</div>
                <div>📶 {networkSpeedRef.current === 'fast' ? '5G' : networkSpeedRef.current === 'medium' ? '4G' : '3G'} • {bandwidthMetrics.currentBandwidth.toFixed(1)} Mb/s</div>
                {errorRecovery.errorState.errorCount > 0 && (
                  <div className="text-yellow-400">
                    Tentative {errorRecovery.errorState.errorCount}/5
                  </div>
                )}
                {errorRecovery.errorState.lastError && (
                  <div className="text-red-400 text-[10px]">
                    {errorRecovery.errorState.lastError}
                  </div>
                )}
              </div>
              {errorRecovery.errorState.isRecovering && errorRecovery.errorState.errorCount >= 3 && (
                <button
                  onClick={() => {
                    errorRecovery.forceStop();
                    setIsLoading(false);
                    toast.info("Récupération annulée");
                  }}
                  className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-xs font-semibold transition-colors"
                >
                  ✕ Annuler la récupération
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showControls && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/85 to-transparent p-4 md:p-6 space-y-3 z-20 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Buffer health bar avec gradient */}
          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden shadow-lg">
            <div 
              className={`h-full transition-all duration-500 ease-out ${
                bufferHealth > 70 ? 'bg-gradient-to-r from-green-500 to-green-400' :
                bufferHealth > 40 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' :
                'bg-gradient-to-r from-red-500 to-red-400'
              }`}
              style={{ width: `${bufferHealth}%` }}
            />
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            {/* Play/Pause */}
            <Button
              size="icon"
              variant="ghost"
              onClick={handlePlayPause}
              className="text-white hover:text-primary hover:bg-white/10 transition-all h-11 w-11 md:h-10 md:w-10"
            >
              {isPlaying ? <Pause className="w-6 h-6 md:w-5 md:h-5" /> : <Play className="w-6 h-6 md:w-5 md:h-5" />}
            </Button>

            {/* Volume controls */}
            <div className="flex items-center gap-2 flex-1 max-w-xs">
              <Button
                size="icon"
                variant="ghost"
                onClick={handleMuteToggle}
                className="text-white hover:text-primary hover:bg-white/10 transition-all h-11 w-11 md:h-10 md:w-10"
              >
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </Button>
              <Slider
                value={[isMuted ? 0 : volume]}
                onValueChange={handleVolumeChange}
                max={1}
                step={0.05}
                className="flex-1 cursor-pointer"
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 md:gap-2 ml-auto">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowSettings(!showSettings)}
                className={`text-white hover:text-primary hover:bg-white/10 transition-all h-11 w-11 md:h-10 md:w-10 ${showSettings ? 'bg-white/10 text-primary' : ''}`}
                title="Paramètres (raccourci: S)"
              >
                <SettingsIcon className="w-5 h-5" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowStats(!showStats)}
                className={`hidden md:flex text-white hover:text-primary hover:bg-white/10 transition-all h-10 w-10 ${showStats ? 'bg-white/10 text-primary' : ''}`}
                title="Analytics Pro"
              >
                <BarChart3 className="w-5 h-5" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={handlePiP}
                className="hidden md:flex text-white hover:text-primary hover:bg-white/10 transition-all h-10 w-10"
                title="Picture-in-Picture (P)"
              >
                <PictureInPicture className="w-5 h-5" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={handleFullscreen}
                className="text-white hover:text-primary hover:bg-white/10 transition-all h-11 w-11 md:h-10 md:w-10"
                title="Plein écran (F)"
              >
                <Maximize className="w-5 h-5" />
              </Button>
            </div>
          </div>
          
          {/* Indicateur vitesse si != 1x */}
          {playbackRate !== 1 && (
            <div className="absolute top-3 right-4 bg-primary text-primary-foreground px-3 py-1.5 rounded-full text-xs font-bold shadow-lg animate-in fade-in slide-in-from-right-2">
              {playbackRate}x
            </div>
          )}
        </div>
      )}
    </div>
  );
};
