# HLS Player - Configuration de Stabilité

## 🎯 Objectif
Amélioration exclusive de la stabilité de lecture HLS et des transitions entre flux, sans modification de l'UI ou des fonctionnalités existantes.

## 🔧 Modifications Techniques

### 1. Configuration HLS.js Optimisée

#### Buffers
- **maxBufferLength**: 60s (au lieu de 4-8s) pour éviter rebuffering
- **maxBufferHole**: 0.7s (tolérance aux trous de buffer)
- **maxBufferSize**: 60MB (tampon mémoire généreux)

#### Retry & Robustesse
- **fragLoadingMaxRetry**: 6 tentatives par fragment
- **fragLoadingRetryDelay**: 500ms initial avec backoff exponentiel (1.5x)
- **fragLoadingTimeOut**: 20s avant timeout

#### ABR (Adaptive Bitrate)
- **abrBandWidthFactor**: 0.95 (utilise 95% de la bande passante estimée)
- **abrEwmaSlowLive**: 7 (stabilité avant changement de qualité)

### 2. Fonction swapStream()

Routine de changement de flux propre qui :

1. **Précharge** le nouveau manifeste (HEAD request)
2. **Attend** le premier fragment chargé avant swap
3. **Détache proprement** l'ancien player (stopLoad → detachMedia → destroy)
4. **Évite** les overlaps mémoire et audio/vidéo double
5. **Délai de sécurité** de 5s max pour préchargement

### 3. Gestion d'Erreurs Robuste

#### Erreurs Non-Fatales
- `bufferStalledError`, `bufferAppendingError`, `bufferSeekOverHole` : récupération automatique avec play()

#### Erreurs Fatales
- **Fragment errors** : retry exponentiel jusqu'à 6 tentatives
- **Network errors** : startLoad() automatique
- **Media errors** : recoverMediaError() puis fallback sur recreate player

### 4. Logs Debug (Optionnels)

Variable `hlsDebugMode.current` pour activer :
- `LEVEL_SWITCHED`
- `BUFFER_APPENDED`
- `FRAG_LOADED`
- `ERROR` (détails)

**Activation** : dans `VideoPlayerHybrid.tsx`, ligne ~66 :
```typescript
const hlsDebugMode = useRef(false); // Passer à true pour debug
```

## 🧪 Tests Manuels (Checklist)

### Test 1 : Stabilité en réseau fluctuant
1. Ouvrir DevTools → Network
2. Activer throttling "Fast 3G" ou "Slow 3G"
3. Lancer un flux HLS
4. **Attendu** : lecture continue sans freeze >2s, max 1-2 rebuffering courts

### Test 2 : Transition entre flux
1. Charger flux HLS A
2. Attendre lecture stable (>10s)
3. Changer vers flux HLS B via sélecteur
4. **Attendu** :
   - Pas d'écran noir >500ms
   - Pas de double audio/vidéo
   - Nouveau flux démarre en <2s

### Test 3 : Erreurs fragment
1. Activer "Offline" dans DevTools pendant 3-5s
2. Revenir "Online"
3. **Attendu** : player récupère automatiquement en <10s sans erreur visible

### Test 4 : Changements de qualité ABR
1. Throttling "Fast 3G" → attendre adaptation qualité
2. Passer à "4G" → vérifier montée progressive en qualité
3. **Attendu** : pas de freeze lors des switchs de niveau

## 📊 Métriques de Succès

- **Rebuffering** : <5% du temps de lecture en 4G
- **Transition flux** : <500ms écran noir, 0 freeze
- **Recovery rate** : 90% des erreurs fragment récupérées automatiquement
- **Freeze** : aucun >3s en conditions réseau normales

## 🔍 Dépannage

### Problème : Transitions lentes entre flux
- Vérifier console : logs "[HLS] FRAG_LOADED"
- Si timeout 5s atteint : vérifier accessibilité manifeste

### Problème : Rebuffering fréquent
- Activer `hlsDebugMode = true`
- Vérifier logs "BUFFER_APPENDED" vs "ERROR"
- Considérer augmenter `maxBufferLength` à 90s

### Problème : Écran noir persistant
- Vérifier `isTransitioningRef.current` non bloqué
- Logs : "Swap already in progress" → race condition

## 🚀 Prochaines Améliorations Possibles

1. Fallback CDN alternatif si fourni en config
2. Métriques de qualité (QoS) persistées
3. Préchargement anticipé du prochain flux (si liste connue)
4. Service Worker pour cache manifestes

---

**Version** : 1.0  
**Date** : 2025-10-26  
**Testeur** : Vérifier les 4 tests manuels avant déploiement production
