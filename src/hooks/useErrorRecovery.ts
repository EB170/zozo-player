import { useRef, useState } from 'react';

interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // ms
  maxDelay: number; // ms
}

interface ErrorState {
  errorCount: number;
  lastError: string | null;
  isRecovering: boolean;
  nextRetryDelay: number;
}

export const useErrorRecovery = (config: RetryConfig = {
  maxRetries: 5,
  baseDelay: 100,
  maxDelay: 10000,
}) => {
  const [errorState, setErrorState] = useState<ErrorState>({
    errorCount: 0,
    lastError: null,
    isRecovering: false,
    nextRetryDelay: config.baseDelay,
  });

  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
      
      console.warn(`⚠️ Error #${newCount}: ${error} (next retry in ${nextDelay}ms)`);
      
      return {
        errorCount: newCount,
        lastError: error,
        isRecovering: false,
        nextRetryDelay: nextDelay,
      };
    });
  };

  const attemptRecovery = (recoveryFn: () => void | Promise<void>): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (errorState.errorCount >= config.maxRetries) {
        console.error('❌ Max retries exceeded');
        reject(new Error('Max retries exceeded'));
        return;
      }

      setErrorState(prev => ({ ...prev, isRecovering: true }));

      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }

      retryTimeoutRef.current = setTimeout(async () => {
        console.log(`🔄 Attempting recovery (${errorState.errorCount + 1}/${config.maxRetries})...`);
        
        try {
          await recoveryFn();
          // Reset sur succès
          setErrorState({
            errorCount: 0,
            lastError: null,
            isRecovering: false,
            nextRetryDelay: config.baseDelay,
          });
          console.log('✅ Recovery successful');
          resolve();
        } catch (err) {
          console.error('❌ Recovery failed:', err);
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
    setErrorState({
      errorCount: 0,
      lastError: null,
      isRecovering: false,
      nextRetryDelay: config.baseDelay,
    });
  };

  const canRetry = errorState.errorCount < config.maxRetries;

  return {
    errorState,
    recordError,
    attemptRecovery,
    reset,
    canRetry,
  };
};
