import { useEffect, useRef, useState, useCallback } from 'react';
import { StreamQuality, recommendQuality } from '@/utils/manifestParser';

interface ABRState {
  currentQuality: StreamQuality | null;
  targetQuality: StreamQuality | null;
  isAdapting: boolean;
  adaptationReason: string;
  switchCount: number;
}

interface ABRConfig {
  enabled: boolean;
  switchThreshold: number; // secondes - temps avant de switch
  minSwitchInterval: number; // ms - minimum entre 2 switches
  bufferTargetUp: number; // secondes - buffer nécessaire pour upscale
  bufferTargetDown: number; // secondes - buffer critique pour downscale
}

export const useAdaptiveBitrate = (
  availableQualities: StreamQuality[],
  currentBandwidth: number, // Mbps
  bufferLevel: number, // secondes
  healthScore: number, // 0-100
  config: ABRConfig = {
    enabled: true,
    switchThreshold: 3,
    minSwitchInterval: 10000,
    bufferTargetUp: 8,
    bufferTargetDown: 2,
  }
) => {
  const [abrState, setAbrState] = useState<ABRState>({
    currentQuality: null,
    targetQuality: null,
    isAdapting: false,
    adaptationReason: '',
    switchCount: 0,
  });

  const lastSwitchTimeRef = useRef(0);
  const switchCountRef = useRef(0);
  const adaptationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stableCountRef = useRef(0);

  // Déterminer la qualité optimale
  const determineOptimalQuality = useCallback(() => {
    if (availableQualities.length === 0 || !config.enabled) {
      return null;
    }

    // Facteur de sécurité basé sur health score
    const safetyFactor = healthScore > 80 ? 0.9 : healthScore > 60 ? 0.75 : 0.6;
    const safeBandwidth = currentBandwidth * safetyFactor;

    // Adapter selon buffer
    let targetBandwidth = safeBandwidth;
    if (bufferLevel < config.bufferTargetDown) {
      // Buffer critique - forcer downgrade agressif
      targetBandwidth = safeBandwidth * 0.7;
    } else if (bufferLevel < config.bufferTargetUp) {
      // Buffer moyen - rester conservateur
      targetBandwidth = safeBandwidth * 0.85;
    } else {
      // Buffer confortable - permettre upgrade
      targetBandwidth = safeBandwidth * 1.0;
    }

    return recommendQuality(targetBandwidth, availableQualities);
  }, [availableQualities, currentBandwidth, bufferLevel, healthScore, config]);

  // Décider si on doit switcher
  const shouldSwitch = useCallback((
    current: StreamQuality | null,
    target: StreamQuality | null
  ): { should: boolean; reason: string } => {
    if (!target || !config.enabled) {
      return { should: false, reason: 'ABR désactivé' };
    }

    const now = Date.now();
    const timeSinceLastSwitch = now - lastSwitchTimeRef.current;

    // Pas de switch trop fréquents
    if (timeSinceLastSwitch < config.minSwitchInterval) {
      return { should: false, reason: 'Trop tôt pour changer' };
    }

    // Premier choix
    if (!current) {
      return { should: true, reason: 'Initialisation qualité' };
    }

    // Même qualité = pas de switch
    if (current.bandwidth === target.bandwidth) {
      return { should: false, reason: 'Qualité déjà optimale' };
    }

    // Downgrade immédiat si buffer critique
    if (bufferLevel < config.bufferTargetDown && target.bandwidth < current.bandwidth) {
      return { should: true, reason: 'Buffer critique - downgrade urgent' };
    }

    // Downgrade si health faible
    if (healthScore < 50 && target.bandwidth < current.bandwidth) {
      return { should: true, reason: 'Santé faible - downgrade recommandé' };
    }

    // Upgrade seulement si conditions optimales et stable
    if (target.bandwidth > current.bandwidth) {
      if (bufferLevel < config.bufferTargetUp) {
        return { should: false, reason: 'Buffer insuffisant pour upgrade' };
      }
      if (healthScore < 70) {
        return { should: false, reason: 'Santé insuffisante pour upgrade' };
      }
      // ✅ Réduit de 3 à 2 checks pour upgrade plus réactif
      if (stableCountRef.current < 2) {
        return { should: false, reason: 'Conditions pas encore stables' };
      }
      return { should: true, reason: 'Conditions optimales - upgrade' };
    }

    // Downgrade si bandwidth insuffisant
    if (target.bandwidth < current.bandwidth) {
      const currentRequiredBandwidth = (current.bandwidth / 1000000) * 1.2; // +20% marge
      if (currentBandwidth < currentRequiredBandwidth) {
        return { should: true, reason: 'Bande passante insuffisante' };
      }
    }

    return { should: false, reason: 'Conditions non réunies' };
  }, [bufferLevel, healthScore, config]);

  // Monitoring et adaptation
  useEffect(() => {
    if (!config.enabled || availableQualities.length === 0) {
      return;
    }

    const checkInterval = setInterval(() => {
      const optimalQuality = determineOptimalQuality();
      
      if (!optimalQuality) return;

      const { should, reason } = shouldSwitch(abrState.currentQuality, optimalQuality);

      if (should) {
        // Attendre quelques secondes avant de switcher (éviter oscillations)
        if (adaptationTimerRef.current) {
          clearTimeout(adaptationTimerRef.current);
        }

        setAbrState(prev => ({
          ...prev,
          targetQuality: optimalQuality,
          isAdapting: true,
          adaptationReason: reason,
        }));

        adaptationTimerRef.current = setTimeout(() => {
          setAbrState(prev => {
            switchCountRef.current++;
            lastSwitchTimeRef.current = Date.now();
            stableCountRef.current = 0;

            if (import.meta.env.DEV) {
              console.log(`🎯 ABR Switch: ${prev.currentQuality?.label || 'none'} → ${optimalQuality.label} (${reason})`);
            }

            return {
              currentQuality: optimalQuality,
              targetQuality: null,
              isAdapting: false,
              adaptationReason: '',
              switchCount: switchCountRef.current,
            };
          });
        }, config.switchThreshold * 1000);
      } else {
        // Conditions stables
        stableCountRef.current++;
        
        if (adaptationTimerRef.current) {
          clearTimeout(adaptationTimerRef.current);
          adaptationTimerRef.current = null;
        }

        setAbrState(prev => ({
          ...prev,
          targetQuality: null,
          isAdapting: false,
          adaptationReason: reason,
        }));
      }
    }, 2000);

    return () => {
      clearInterval(checkInterval);
      if (adaptationTimerRef.current) {
        clearTimeout(adaptationTimerRef.current);
      }
    };
  }, [config, availableQualities, determineOptimalQuality, shouldSwitch, abrState.currentQuality]);

  const setManualQuality = useCallback((quality: StreamQuality | null) => {
    setAbrState({
      currentQuality: quality,
      targetQuality: null,
      isAdapting: false,
      adaptationReason: 'Manuel',
      switchCount: switchCountRef.current,
    });
    stableCountRef.current = 0;
  }, []);

  return { abrState, setManualQuality };
};
