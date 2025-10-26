import { useEffect, useRef, useState, useCallback } from 'react';

export interface HealthStatus {
  score: number; // 0-100
  level: 'excellent' | 'good' | 'warning' | 'critical';
  issues: string[];
  recommendations: string[];
  stallCount: number;
  bufferingTime: number; // ms total spent buffering
  lastStallTime: number;
}

interface HealthMonitorConfig {
  checkInterval: number; // ms
  stallThreshold: number; // ms without progress = stall
  criticalBufferLevel: number; // seconds
  warningBufferLevel: number; // seconds
}

export const useHealthMonitor = (
  videoElement: HTMLVideoElement | null,
  config: HealthMonitorConfig = {
    checkInterval: 1000,
    stallThreshold: 2000,
    criticalBufferLevel: 1,
    warningBufferLevel: 3,
  }
) => {
  const [health, setHealth] = useState<HealthStatus>({
    score: 100,
    level: 'excellent',
    issues: [],
    recommendations: [],
    stallCount: 0,
    bufferingTime: 0,
    lastStallTime: 0,
  });

  const lastTimeRef = useRef(0);
  const lastCheckRef = useRef(Date.now());
  const stalledSinceRef = useRef<number | null>(null);
  const totalBufferingTimeRef = useRef(0);
  const stallCountRef = useRef(0);

  const calculateScore = useCallback((
    bufferLevel: number,
    droppedFrameRate: number,
    stallCount: number,
    bufferingTime: number
  ): number => {
    let score = 100;

    // Penalité buffer (40 points max) - adapté pour live streaming
    if (bufferLevel < 0.5) {
      score -= 40; // Critique absolu
    } else if (bufferLevel < config.criticalBufferLevel) { // 1s
      score -= 25; // Critique mais tolérable pour live
    } else if (bufferLevel < config.warningBufferLevel) { // 3s
      score -= 15; // Warning léger
    } else if (bufferLevel < 5) {
      score -= 5; // Optimal pour live
    }

    // Penalité dropped frames (30 points max)
    if (droppedFrameRate > 5) {
      score -= 30;
    } else if (droppedFrameRate > 2) {
      score -= 15;
    } else if (droppedFrameRate > 0.5) {
      score -= 5;
    }

    // Penalité stalls (20 points max) - plus tolérant
    if (stallCount > 8) {
      score -= 20;
    } else if (stallCount > 4) {
      score -= 10;
    } else if (stallCount > 1) {
      score -= 5;
    }

    // Penalité temps de buffering total (10 points max)
    const bufferingRatio = bufferingTime / (Date.now() - lastCheckRef.current);
    if (bufferingRatio > 0.3) {
      score -= 10;
    } else if (bufferingRatio > 0.15) {
      score -= 5;
    }

    return Math.max(0, Math.min(100, score));
  }, [config]);

  useEffect(() => {
    if (!videoElement) return;

    const monitorInterval = setInterval(() => {
      const now = Date.now();
      const currentTime = videoElement.currentTime;

      // Détection stall avancée
      const timeSinceLastCheck = now - lastCheckRef.current;
      const progressMade = currentTime - lastTimeRef.current;

      let isStalled = false;
      if (!videoElement.paused && progressMade === 0 && timeSinceLastCheck > config.stallThreshold) {
        isStalled = true;
        
        if (!stalledSinceRef.current) {
          stalledSinceRef.current = now;
          stallCountRef.current++;
        }
        
        totalBufferingTimeRef.current += timeSinceLastCheck;
      } else if (stalledSinceRef.current && progressMade > 0) {
        // Recovery from stall
        stalledSinceRef.current = null;
      }

      // Buffer level
      let bufferLevel = 0;
      if (videoElement.buffered.length > 0) {
        bufferLevel = videoElement.buffered.end(0) - currentTime;
      }

      // Dropped frames rate
      let droppedFrameRate = 0;
      // @ts-ignore
      const quality = videoElement.getVideoPlaybackQuality?.();
      if (quality && quality.totalVideoFrames > 0) {
        droppedFrameRate = (quality.droppedVideoFrames / quality.totalVideoFrames) * 100;
      }

      // Calculate health score
      const score = calculateScore(
        bufferLevel,
        droppedFrameRate,
        stallCountRef.current,
        totalBufferingTimeRef.current
      );

      // Determine level
      let level: 'excellent' | 'good' | 'warning' | 'critical' = 'excellent';
      if (score < 30) level = 'critical';
      else if (score < 60) level = 'warning';
      else if (score < 85) level = 'good';

      // Identify issues
      const issues: string[] = [];
      if (bufferLevel < config.criticalBufferLevel) {
        issues.push('Buffer critique');
      } else if (bufferLevel < config.warningBufferLevel) {
        issues.push('Buffer faible');
      }

      if (droppedFrameRate > 2) {
        issues.push(`${droppedFrameRate.toFixed(1)}% frames perdus`);
      }

      if (stallCountRef.current > 2) {
        issues.push(`${stallCountRef.current} interruptions`);
      }

      if (isStalled) {
        issues.push('Lecture interrompue');
      }

      // Recommendations
      const recommendations: string[] = [];
      if (bufferLevel < config.warningBufferLevel) {
        recommendations.push('Réduire la qualité');
      }
      if (droppedFrameRate > 2) {
        recommendations.push('Fermer autres onglets');
      }
      if (stallCountRef.current > 3) {
        recommendations.push('Vérifier connexion réseau');
      }

      setHealth({
        score,
        level,
        issues,
        recommendations,
        stallCount: stallCountRef.current,
        bufferingTime: totalBufferingTimeRef.current,
        lastStallTime: stalledSinceRef.current || 0,
      });

      // Update refs
      lastTimeRef.current = currentTime;
      lastCheckRef.current = now;
    }, config.checkInterval);

    return () => clearInterval(monitorInterval);
  }, [videoElement, config, calculateScore]);

  const reset = useCallback(() => {
    stallCountRef.current = 0;
    totalBufferingTimeRef.current = 0;
    stalledSinceRef.current = null;
    setHealth({
      score: 100,
      level: 'excellent',
      issues: [],
      recommendations: [],
      stallCount: 0,
      bufferingTime: 0,
      lastStallTime: 0,
    });
  }, []);

  return { health, reset };
};
