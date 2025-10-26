import { useEffect, useRef, useState } from 'react';

interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // ms
  maxDelay: number; // ms
  globalTimeout: number; // ms - timeout global de sécurité
}

interface ErrorState {
  errorCount: number;
  lastError: string | null;
  isRecovering: boolean;
  nextRetryDelay: number;
  recoveryStartTime: number;
}

export const useErrorRecovery = (config: RetryConfig = {
  maxRetries: 5,
  baseDelay: 100,
  maxDelay: 10000,
  globalTimeout: 30000, // 30s max
}) => {
  const [errorState, setErrorState] = useState<ErrorState>({
    errorCount: 0,
    lastError: null,
    isRecovering: false,
    nextRetryDelay: config.baseDelay,
    recoveryStartTime: 0,
  });

  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const globalTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (globalTimeoutRef.current) {
        clearTimeout(globalTimeoutRef.current);
      }
    };
  }, []);

  // Backoff exponentiel avec jitter
  const calculateBackoff = (attemptNumber: number): number => {
    const exponentialDelay = Math.min(
      config.baseDelay * Math.pow(2, attemptNumber),
      config.maxDelay
    );
    
    // Ajouter jitter aléatoire (±25%)
    const jitter = exponentialDelay * 0.25 * (Math.random() - 0.5);
    return Math.round(exponentialDelay + jitter);
  };

  const recordError = (error: string) => {
    setErrorState(prev => {
      const newCount = prev.errorCount + 1;
      const nextDelay = calculateBackoff(newCount);
      
      console.warn(`⚠️ Error #${newCount}/${config.maxRetries}: ${error} (next retry in ${nextDelay}ms)`);
      
      return {
        errorCount: newCount,
        lastError: error,
        isRecovering: false,
        nextRetryDelay: nextDelay,
        recoveryStartTime: prev.recoveryStartTime || Date.now(),
      };
    });
  };

  const attemptRecovery = (recoveryFn: () => void | Promise<void>): Promise<void> => {
    return new Promise((resolve, reject) => {
      // Check immédiat avant de commencer
      if (errorState.errorCount >= config.maxRetries) {
        console.error('❌ Max retries exceeded');
        setErrorState(prev => ({ ...prev, isRecovering: false }));
        reject(new Error('Max retries exceeded'));
        return;
      }

      // Check timeout global
      const recoveryStartTime = errorState.recoveryStartTime || Date.now();
      const elapsed = Date.now() - recoveryStartTime;
      if (elapsed > config.globalTimeout) {
        console.error(`❌ Global timeout exceeded (${elapsed}ms)`);
        setErrorState(prev => ({ ...prev, isRecovering: false }));
        reject(new Error('Recovery timeout'));
        return;
      }

      console.log(`🔄 Attempting recovery (${errorState.errorCount + 1}/${config.maxRetries})...`);
      
      // Mettre en mode recovering AVANT le setTimeout
      setErrorState(prev => ({ 
        ...prev, 
        isRecovering: true,
        recoveryStartTime: prev.recoveryStartTime || Date.now(),
      }));

      // Clear existing timers
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (globalTimeoutRef.current) {
        clearTimeout(globalTimeoutRef.current);
      }

      // Global timeout de sécurité
      globalTimeoutRef.current = setTimeout(() => {
        console.error('❌ Recovery global timeout - forcing stop');
        setErrorState(prev => ({
          ...prev,
          isRecovering: false,
          lastError: 'Timeout global',
        }));
        reject(new Error('Global recovery timeout'));
      }, config.globalTimeout);

      // Retry avec backoff
      retryTimeoutRef.current = setTimeout(async () => {
        try {
          console.log(`🔧 Executing recovery function...`);
          await recoveryFn();
          
          // Clear global timeout on success
          if (globalTimeoutRef.current) {
            clearTimeout(globalTimeoutRef.current);
            globalTimeoutRef.current = null;
          }
          
          // Reset sur succès
          console.log('✅ Recovery successful - resetting error state');
          setErrorState({
            errorCount: 0,
            lastError: null,
            isRecovering: false,
            nextRetryDelay: config.baseDelay,
            recoveryStartTime: 0,
          });
          resolve();
        } catch (err) {
          console.error('❌ Recovery failed:', err);
          
          // Clear global timeout
          if (globalTimeoutRef.current) {
            clearTimeout(globalTimeoutRef.current);
            globalTimeoutRef.current = null;
          }
          
          setErrorState(prev => ({
            ...prev,
            isRecovering: false,
            lastError: err instanceof Error ? err.message : 'Unknown error',
          }));
          reject(err);
        }
      }, errorState.nextRetryDelay);
    });
  };

  const reset = () => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (globalTimeoutRef.current) {
      clearTimeout(globalTimeoutRef.current);
      globalTimeoutRef.current = null;
    }
    console.log('🔄 Error recovery reset');
    setErrorState({
      errorCount: 0,
      lastError: null,
      isRecovering: false,
      nextRetryDelay: config.baseDelay,
      recoveryStartTime: 0,
    });
  };

  const forceStop = () => {
    console.warn('⚠️ Force stopping recovery');
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (globalTimeoutRef.current) {
      clearTimeout(globalTimeoutRef.current);
      globalTimeoutRef.current = null;
    }
    setErrorState(prev => ({
      ...prev,
      isRecovering: false,
    }));
  };

  const canRetry = errorState.errorCount < config.maxRetries;

  return {
    errorState,
    recordError,
    attemptRecovery,
    reset,
    forceStop,
    canRetry,
  };
};
