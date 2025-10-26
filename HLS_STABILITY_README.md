# Stabilité Vidéo Long-Terme - Configuration Multi-Heures

## 🎯 Objectif

Configuration optimisée pour lecture continue de plusieurs heures sans coupures, freeze ni comportements étranges, pour flux HLS et MPEG-TS.

## 🔧 Améliorations Implémentées

### 1. Configuration HLS.js Optimisée Long-Terme

#### Buffers et Mémoire
```javascript
maxBufferLength: 45s           // Équilibre stabilité/mémoire
maxMaxBufferLength: 60s        // Cap pour éviter saturation
maxBufferSize: 50MB            // Limite mémoire prudente
maxBufferHole: 0.5s            // Tolérance petits trous
backBufferLength: 15s          // Nettoyage automatique ancien buffer
```

**Pourquoi 45s au lieu de 60s ?**
- Évite accumulation mémoire excessive sur plusieurs heures
- Le `backBufferLength` assure nettoyage automatique continu
- Toujours suffisant pour absorber fluctuations réseau 4G

#### Retry et Robustesse
```javascript
fragLoadingMaxRetry: 6         // 6 tentatives par fragment
fragLoadingRetryDelay: 500ms   // Backoff exponentiel
fragLoadingTimeOut: 20000      // 20s timeout
```

#### ABR Stable
```javascript
abrEwmaFastLive: 3
abrEwmaSlowLive: 7
abrBandWidthFactor: 0.95       // Marge sécurité 5%
abrBandWidthUpFactor: 0.7      // Montée prudente
```

### 2. Configuration MPEG-TS Optimisée

```javascript
stashInitialSize: 4MB          // Buffer initial généreux
autoCleanupMaxBackwardDuration: 60s
autoCleanupMinBackwardDuration: 30s
liveBufferLatencyMaxLatency: 15s    // Très tolérant
liveBufferLatencyMinRemain: 6s      // Garde 6s minimum
liveBufferLatencyChasing: false     // DÉSACTIVÉ pour stabilité max
lazyLoad: false                     // Prefetch immédiat
fixAudioTimestampGap: true          // Corrige drifts audio/vidéo
```

### 3. Système de Watchdog Réactif

#### MPEG-TS Watchdog (toutes les 1.5s)
```javascript
// Vérifications:
- Buffer critique (<1s) → unload/reload automatique
- Freeze vidéo (>2s sans timeUpdate) → force play()
- Suivi currentTime pour détecter gelages silencieux
```

#### HLS Watchdog (intégré)
```javascript
// Recovery automatique:
- bufferStalledError → play() après 1s
- FRAG_LOAD_ERROR → retry exponentiel 6x
- MEDIA_ERROR → recoverMediaError()
```

### 4. 🔧 Maintenance Préventive Long-Terme

#### MPEG-TS: Toutes les 20 minutes
```javascript
// Vérifications automatiques:
1. Taux de frames perdus (>5% → soft reload)
2. Taille buffer total (>90s → cleanup forcé)
3. Qualité playback globale

// Actions préventives:
- unload() + load() + restaure currentTime
- Évite accumulation problèmes sur longue durée
- Log: "🔧 Maintenance préventive (uptime: Xmin)"
```

#### HLS: Chaque minute (vérif tous les 15min)
```javascript
// Vérifications automatiques:
1. Taux de frames perdus (>8% → recoverMediaError)
2. Buffer total (>120s → stopLoad/startLoad cleanup)

// Actions préventives:
- Nettoyage doux du buffer si trop plein
- Recovery media si dégradation détectée
- Log: "🔧 HLS Maintenance (uptime: Xmin)"
```

### 5. Gestion Mémoire Robuste

#### Nettoyage Automatique
- **HLS**: `backBufferLength: 15s` supprime ancien buffer
- **MPEG-TS**: `autoCleanupMaxBackwardDuration: 60s`
- **Maintenance**: Force cleanup si buffer >90s (MPEG-TS) ou >120s (HLS)

#### Prévention Fuites Mémoire
- Cleanup complet dans `useEffect` return
- Destruction propre instances player (stopLoad → detach → destroy)
- Clear de tous intervals (watchdog, maintenance)
- Reset refs à chaque init

### 6. Fonction swapStream() - Transition Fluide

```javascript
// Workflow optimisé HLS → HLS:
1. Créer nouvelle instance HLS
2. Précharger manifeste (HEAD request)
3. loadSource() + attachMedia()
4. Attendre FRAG_LOADED (timeout 5s)
5. Détacher et détruire ancien player
6. Relancer play()
```

**Résultat**: Transition <500ms, pas d'écran noir, pas de double audio

### 7. Gestion Erreurs Complète

#### Erreurs Non-Fatales (Auto-Recovery)
```javascript
// HLS
bufferStalledError → play() après 1s
bufferAppendingError → play() après 1s
bufferSeekOverHole → play() après 1s

// MPEG-TS
Buffer critique (<1s) → unload/reload
Freeze (>2s) → force play()
```

#### Erreurs Fatales (Retry Exponentiel)
```javascript
FRAG_LOAD_ERROR → 6 retries (500ms, 750ms, 1125ms...)
NETWORK_ERROR → retry avec proxy si dispo
MEDIA_ERROR → recoverMediaError() puis recreate si échec
```

### 8. Debug Logging

#### Activer Debug HLS
```javascript
// Dans VideoPlayerHybrid.tsx, ligne ~66
const hlsDebugMode = useRef(true); // true pour debug
```

**Affiche:**
- LEVEL_SWITCHED, BUFFER_APPENDED, FRAG_LOADED
- ERROR avec détails complets

#### Logs Automatiques Importants
```
✅ Lecture démarrée
🔄 Retry X/5 in Yms
🚨 Buffer critique détecté
🔧 Maintenance préventive (uptime: Xmin)
🧹 Buffer cleanup...
⚠️ Qualité dégradée (X% frames perdus)
```

## 🧪 Checklist Test Long-Terme

### Test 1: Lecture Continue (4+ heures)
1. Lancer flux MPEG-TS ou HLS
2. Laisser tourner **minimum 4 heures**
3. **Vérifier console:**
   - Logs maintenance toutes les 20min (MPEG-TS) ou 15min (HLS)
   - Uptime affiché correctement
   - Pas d'erreurs fatales répétées
4. **Vérifier visuellement:** Aucun freeze/stutter

**Critère succès:** Lecture ininterrompue 4h+

### Test 2: Réseau Instable
1. Throttling Chrome: 3G ou 4G fluctuant
2. Lecture **30 minutes minimum**
3. **Vérifier:**
   - Recovery automatique sans intervention
   - Max 3-4 bufferings courts acceptés
   - Console: retry automatiques visibles

**Critère succès:** <5 rebufferings sur 30min

### Test 3: Changement Flux (Zapping IPTV)
1. Zapper entre chaînes toutes les 30s
2. Répéter pendant **10 minutes**
3. **Vérifier:**
   - Transitions fluides
   - Pas d'écran noir >500ms
   - Pas de crash mémoire

**Critère succès:** Transitions stables, aucun crash

### Test 4: Mémoire Long-Terme
1. DevTools → Performance Monitor
2. Lancer lecture **2 heures minimum**
3. **Observer "JS Heap Size":**
   - Doit rester stable (pas croissance continue)
   - Pics OK, mais retour à baseline après cleanup

**Critère succès:** Heap stable ±20% variations

### Test 5: Mixed Content (HTTPS)
1. Flux MPEG-TS HTTP sur page HTTPS
2. **Vérifier console:**
   - "🔒 Mixed Content detected, using proxy automatically"
   - Lecture démarre sans erreur CORS

**Critère succès:** Proxy automatique, pas d'erreur

## 📊 Métriques de Succès Cibles

### Stabilité
- **Uptime:** >4h sans crash ni reload manuel
- **Bufferings:** <5 par heure en 4G stable
- **Frames perdus:** <3% sur 1 heure
- **Recovery auto:** 95% erreurs non-fatales récupérées

### Mémoire
- **JS Heap:** Stable, pas de croissance linéaire
- **Variations:** ±20% acceptables
- **Cleanup:** Visible dans Performance Monitor après maintenance

### Comportement Temporel
- **0-15min:** Lecture parfaite, watchdog silencieux
- **15-20min:** Première maintenance logged
- **20-40min:** Seconde maintenance, vérif mémoire OK
- **40min-4h:** Pattern stable, pas de dégradation

## 🔍 Dépannage

### Problème: Rebuffering fréquent (>10/h)
**Solutions:**
1. Activer `hlsDebugMode = true`
2. Vérifier logs BUFFER_APPENDED vs ERROR
3. Considérer augmenter maxBufferLength à 60s (HLS)
4. Vérifier bande passante réelle (useRealBandwidth)

### Problème: Mémoire croissante continue
**Solutions:**
1. Vérifier cleanup() appelé correctement
2. Vérifier intervals cleared (watchdog, maintenance)
3. Console: chercher "Maintenance préventive" toutes les 15-20min
4. Si absent, vérifier `memoryCleanupIntervalRef` non null

### Problème: Freeze après 1-2h
**Solutions:**
1. Vérifier logs: "🔧 Maintenance" doit apparaître
2. Vérifier taux frames perdus dans logs maintenance
3. Si >5%, soft reload automatique devrait se déclencher
4. Sinon, réduire seuil dans maintenance (ligne ~288 ou ~560)

### Problème: Transitions lentes entre flux
**Solutions:**
1. Console: vérifier "🔄 Swapping stream"
2. Si timeout 5s atteint: vérifier accessibilité manifeste
3. Vérifier `isTransitioningRef` pas bloqué
4. Logs "Swap already in progress" → race condition

## 🏗️ Architecture

```
┌─────────────────────────────────────┐
│   VideoPlayerHybrid                 │
├─────────────────────────────────────┤
│  ┌──────────────┐  ┌─────────────┐ │
│  │ HLS.js       │  │ mpegts.js   │ │
│  │ 45s buffer   │  │ 4MB buffer  │ │
│  │ 15s backBuf  │  │ 60s cleanup │ │
│  └──────┬───────┘  └──────┬──────┘ │
│         │                  │        │
│  ┌──────▼──────────────────▼─────┐ │
│  │   Watchdog (1.5s)             │ │
│  │   • Buffer check              │ │
│  │   • Freeze detection          │ │
│  └──────┬────────────────────────┘ │
│         │                           │
│  ┌──────▼──────────────────────┐   │
│  │ Maintenance (15-20min)      │   │
│  │ • Quality check             │   │
│  │ • Memory cleanup            │   │
│  │ • Preventive recovery       │   │
│  └──────┬──────────────────────┘   │
│         │                           │
│  ┌──────▼──────────────────────┐   │
│  │ Error Recovery              │   │
│  │ • Retry exponential         │   │
│  │ • Auto proxy fallback       │   │
│  │ • Silent recovery           │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

## 🚀 Optimisations Spécifiques

### Mixed Content HTTPS
- Détection auto page HTTPS + flux HTTP
- Force proxy immédiatement (évite erreur + delay)

### Swap Stream (HLS → HLS)
- Précharge manifeste
- Attend FRAG_LOADED avant destroy ancien
- Pas d'overlap audio/video

### Monitoring Continue
- `useVideoMetrics`: FPS, résolution, frames
- `useRealBandwidth`: Bande passante mesurée
- `useHealthMonitor`: Score santé global

## 📝 Configuration Production

```javascript
// Désactiver debug (ligne ~66 VideoPlayerHybrid.tsx)
const hlsDebugMode = useRef(false); // ← false en prod

// Logs essentiels restent (✅🔄🚨🔧) pour monitoring
```

## 🎓 Commandes Debug Chrome

```javascript
// Dans console pendant lecture:
window.hls = hlsRef.current;
hls.currentLevel;                     // Niveau qualité actuel
hls.levels;                           // Tous niveaux disponibles
hls.media.buffered.end(0);            // Fin buffer (secondes)
video.getVideoPlaybackQuality();      // Frames perdus
video.currentTime;                    // Position actuelle
```

---

**Version:** 2.0 Long-Terme  
**Date:** 2025-10-26  
**Configuration:** Multi-heures sans intervention
