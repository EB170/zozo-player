# 🎯 Configuration HLS.js Professionnelle – Guide Complet

## 📘 Vue d'Ensemble

Ce document explique en détail la configuration HLS.js **niveau production** implémentée dans le player, basée sur les meilleures pratiques des grandes plateformes de streaming (Netflix, YouTube, Twitch).

**Objectifs** :
- ✅ **Zéro coupure** (buffering) sur connexions instables
- ✅ **Zéro saccade** (stuttering) lors des changements de qualité ABR
- ✅ **Latence minimale** pour le live tout en restant stable
- ✅ **Tolérance maximale** aux flux TS de mauvaise qualité (timestamps incorrects, paquets corrompus)

---

## 1️⃣ STRATÉGIE DE BUFFERING (La Plus Critique)

### 🧠 Concept : "Fenêtre Glissante" Agressive

Le buffer est une **fenêtre temporelle** qui précharge les segments vidéo en avance pour éviter les coupures. La configuration doit équilibrer :
- **Stabilité** : Buffer large = tolérance aux variations réseau
- **Mémoire** : Buffer trop large = crash OOM sur mobiles
- **Latence** : Buffer large = décalage avec le direct (pour live)

### ⚙️ Configuration Implémentée

```typescript
maxBufferLength: 120,              // 120s buffer forward (2 minutes)
maxMaxBufferLength: 180,           // Cap absolu 3 minutes
maxBufferSize: 150 * 1000 * 1000,  // 150 MB max
maxBufferHole: 0.15,               // 150ms tolérance gaps
backBufferLength: 10,              // 10s historique (seek arrière)
```

### 📊 Pourquoi Ces Valeurs ?

#### `maxBufferLength: 120s`
- **Netflix-level** : 2 minutes de buffer forward garantit zéro coupure même sur réseau instable
- **Balance** : Assez large pour absorber les pics de latence réseau, mais pas excessif pour éviter OOM
- **VOD vs Live** : Pour VOD, on pourrait aller à 180s. Pour live, 120s est optimal (latence acceptable)

#### `maxMaxBufferLength: 180s`
- **Sécurité ultime** : Cap à 3min empêche accumulation infinie si réseau ultra-rapide
- **Memory safety** : Empêche crashes OOM sur devices avec RAM limitée

#### `maxBufferSize: 150MB`
- **Calcul** : ~10Mbps bitrate × 120s = 150MB (approximation)
- **Mobile-safe** : Laisse de la marge pour autres apps, évite kill par l'OS

#### `maxBufferHole: 0.15s`
- **Strict** : 150ms de tolérance pour les "trous" dans le buffer (discontinuités)
- **Pourquoi strict ?** : Force HLS.js à combler rapidement les gaps plutôt que de les ignorer
- **Alternative** : 0.5s serait plus "permissif" mais risque saccades

#### `backBufferLength: 10s`
- **Seek backward** : Garde 10s derrière la position courante pour navigation rapide
- **Cleanup auto** : HLS.js nettoie au-delà pour économiser RAM

---

## 2️⃣ OPTIMISATION ABR (Adaptive Bitrate Switching)

### 🧠 Concept : EWMA (Exponential Weighted Moving Average)

L'ABR estime la bande passante disponible pour choisir la meilleure qualité. Le problème : la BP varie constamment !

**Solution** : Moyenne glissante pondérée avec 2 fenêtres :
- **Fast EWMA** : Réagit vite aux drops (évite buffering)
- **Slow EWMA** : Lisse les variations (évite switches intempestifs)

### ⚙️ Configuration Implémentée

```typescript
// EWMA WEIGHTS
abrEwmaFastLive: 2.0,              // Fenêtre rapide 2s
abrEwmaSlowLive: 12.0,             // Fenêtre lente 12s
abrEwmaDefaultEstimate: 500000,    // 500kbps initial

// BANDWIDTH SAFETY MARGINS
abrBandWidthFactor: 0.90,          // Downswitch à 90% BP
abrBandWidthUpFactor: 0.65,        // Upswitch à 65% BP
abrMaxWithRealBitrate: true,
minAutoBitrate: 0,

// START LEVEL
startLevel: -1,                    // Auto-detect
testBandwidth: true,               // Mesure BP avant démarrage
```

### 📊 Pourquoi Ces Valeurs ?

#### `abrEwmaFastLive: 2.0` & `abrEwmaSlowLive: 12.0`
- **Fast = 2s** : Détecte rapidement les drops (évite buffering)
- **Slow = 12s** : Lisse les variations sur 12s (stabilité)
- **Ratio 6:1** : Balance idéale pour live stable
- **Alternative** : `3.0` / `9.0` serait plus réactif mais moins stable

#### `abrBandWidthFactor: 0.90` (Downswitch)
- **Marge 10%** : Passe à qualité inférieure si BP < 90% de l'estimation
- **Conservateur** : Évite buffering au prix de qualité
- **Industrie** : Netflix utilise ~85-90%

#### `abrBandWidthUpFactor: 0.65` (Upswitch)
- **Marge 35%** : Monte en qualité seulement si BP > 65% du bitrate cible
- **TRÈS conservateur** : Évite switches ratés qui causent saccades
- **Pourquoi ?** : Monter en qualité est "risqué" (si échec = buffering), donc on attend d'être sûr
- **Alternative** : 0.75 serait plus agressif mais moins stable

#### `abrMaxWithRealBitrate: true`
- **Mesure réelle** : Utilise le bitrate réel des segments téléchargés (pas juste le manifest)
- **Précision** : Évite les surprises (ex: manifest dit 5Mbps mais segments font 7Mbps)

#### `startLevel: -1` + `testBandwidth: true`
- **Auto-detect** : Mesure BP réelle avant de commencer
- **Smart start** : Évite de démarrer en 1080p sur connexion 3G (frustration user)

---

## 3️⃣ GESTION D'ERREURS ROBUSTE (Error Handling)

### 🧠 Concept : Retry Progressif Multi-Niveaux

Les erreurs réseau sont inévitables (packet loss, timeouts, serveurs surchargés). La stratégie pro :
1. **Retry immédiat** (erreur transitoire ?)
2. **Backoff exponentiel** (éviter spam serveur)
3. **Degradation gracieuse** (baisser qualité)
4. **Last resort** (recréer player complet)

### ⚙️ Retry Policies Implémentées

```typescript
// MANIFEST RETRIES
manifestLoadingTimeOut: 12000,
manifestLoadingMaxRetry: 6,
manifestLoadingRetryDelay: 500,
manifestLoadingMaxRetryTimeout: 60000,

// LEVEL RETRIES
levelLoadingTimeOut: 10000,
levelLoadingMaxRetry: 6,
levelLoadingRetryDelay: 500,
levelLoadingMaxRetryTimeout: 60000,

// FRAGMENT RETRIES (LE PLUS CRITIQUE)
fragLoadingTimeOut: 20000,
fragLoadingMaxRetry: 10,
fragLoadingRetryDelay: 300,
fragLoadingMaxRetryTimeout: 90000,
```

### 📊 Pourquoi Ces Valeurs ?

#### Manifest : `6 retries` × `500ms → 60s`
- **Critique** : Sans manifest, rien ne fonctionne
- **Backoff** : 500ms → 1s → 2s → 4s → 8s → 16s (total ~31s max)
- **60s cap** : Évite d'attendre indéfiniment

#### Fragments : `10 retries` × `300ms → 90s`
- **Les plus fréquents** : 90% des erreurs HLS sont des fragments 404/timeout
- **10 tentatives** : Maximum de chances de succès
- **Backoff rapide** : 300ms → 600ms → 1.2s → 2.4s... (total ~80s)
- **90s cap** : Pour connexions ultra-lentes (satellite, etc.)

### 🔧 Stratégies d'Error Recovery

#### FRAG_LOAD_ERROR (Erreurs Fragment)
```typescript
Phase 1 : Retry 8× avec backoff (300ms → 1.8s)
Phase 2 : Si échec, forcer qualité inférieure
Phase 3 : Dernier recours → recreate player complet
```

#### MEDIA_ERROR (Corruption, Codec Issues)
```typescript
Tentative 1 : hls.recoverMediaError()
Tentative 2 : hls.swapAudioCodec() + recoverMediaError()
Tentative 3 : Recreate player complet
```

#### NETWORK_ERROR (Fatal)
```typescript
Tentative 1-3 : hls.startLoad() avec delay
Tentative 4+ : Recreate player complet
```

### 💡 Erreurs Non-Fatales (Auto-Recovery Silencieux)

```typescript
BUFFER_STALLED_ERROR → Attendre 1s puis play()
BUFFER_SEEK_OVER_HOLE → Nudge +100ms
BUFFER_APPEND_ERROR → Continue (HLS.js gère auto)
```

---

## 4️⃣ LIVE EDGE MANAGEMENT (Flux en Direct)

### 🧠 Concept : Maintenir Latence Cible Stable

Pour les flux live, le player doit rester à une **distance fixe** du "bord live" (live edge). Problèmes :
- **Trop proche** : Risque buffering (segments pas encore disponibles)
- **Trop loin** : Latence excessive (utilisateur voit du "vieux" contenu)

### ⚙️ Configuration Live Sync

```typescript
liveSyncDurationCount: 4,          // Position cible : 4 segments du bord
liveMaxLatencyDurationCount: 10,   // Max 10 segments de retard
maxLiveSyncPlaybackRate: 1.08,     // Rattrapage à 108%
```

### 📊 Pourquoi Ces Valeurs ?

#### `liveSyncDurationCount: 4`
- **Position cible** : 4 segments avant le bord (ex: 4 × 6s = 24s de latence)
- **Balance** : Assez loin pour stabilité, assez proche pour "feeling live"
- **Alternative** :
  - `3` = plus proche live (18s) mais moins stable
  - `5` = plus stable mais latence +30s

#### `liveMaxLatencyDurationCount: 10`
- **Seuil déclenchement** : Si >10 segments de retard (60s), rattraper
- **Tolérant** : Évite rattrapage intempestif sur petites variations

#### `maxLiveSyncPlaybackRate: 1.08`
- **Rattrapage progressif** : 108% speed (imperceptible pour user)
- **Subtil** : Meilleur que seek brutal (pas de glitch visuel)
- **Alternative** : 1.05 = plus lent, 1.15 = risque détection par user

### 🔧 Algorithme de Rattrapage Implémenté

```typescript
setInterval(() => {
  const latency = hls.liveSyncPosition - video.currentTime;
  
  if (latency > 60s) {
    // Rattrapage progressif (invisible)
    video.playbackRate = 1.08;
  }
  
  if (latency > 120s) {
    // Seek direct (erreur grave, manifest gelé)
    video.currentTime = liveSyncPosition - 10s;
  }
  
  if (latency < 10s) {
    // Trop proche du live, ralentir
    video.playbackRate = 0.95;
  }
  
  if (latency entre 30-60s) {
    // Zone idéale, vitesse normale
    video.playbackRate = 1.0;
  }
}, 5000); // Check tous les 5s
```

### 💡 Options de Rattrapage

#### Option 1 : `playbackRate` (PRÉFÉRÉ)
- **Avantages** : Invisible, fluide, pas de glitch visuel
- **Inconvénient** : Lent (rattraper 30s prend ~6min à 108%)
- **Usage** : Rattrapage progressif <60s

#### Option 2 : `video.currentTime` (DERNIER RECOURS)
- **Avantages** : Instantané
- **Inconvénient** : Visible (seek = discontinuité perçue)
- **Usage** : Urgence si >120s de retard (manifest gelé)

---

## 5️⃣ OPTIMISATIONS DEMUXER/REMUXER

### 🧠 Concept : Tolérance aux Flux TS de Mauvaise Qualité

Les flux IPTV/live ont souvent des problèmes :
- **Timestamps PTS/DTS** incorrects (décalage A/V)
- **Paquets TS corrompus** (bits flippés)
- **Discontinuités** non signalées (changement source)

### ⚙️ Configuration Tolérance

```typescript
enableWorker: true,                // Parsing dans Web Worker
progressive: true,                 // Lecture pendant download
forceKeyFrameOnDiscontinuity: true, // Force keyframe après discontinuité
maxFragLookUpTolerance: 0.15,      // Tolérance 150ms recherche fragment
```

### 📊 Pourquoi Ces Valeurs ?

#### `enableWorker: true`
- **Performance** : Déplace parsing TS dans Web Worker (libère main thread)
- **Impact** : UI reste fluide même pendant parsing de gros segments
- **Mobile** : CRITIQUE sur devices low-end (évite lag UI)

#### `progressive: true`
- **Streaming progressif** : Commence à lire avant fin téléchargement segment
- **Latence** : Réduit temps "waiting" (UX meilleure)
- **Requis** : Serveur doit supporter byte-range requests

#### `forceKeyFrameOnDiscontinuity: true`
- **Recovery** : Force démarrage sur keyframe après discontinuité
- **Évite** : Corruption visuelle (blocs verts, artefacts)
- **Cost** : Peut sauter quelques frames, mais préférable à corruption

#### `lowLatencyMode: false`
- **Priorité stabilité** : LL-HLS désactivé (moins mature, moins stable)
- **Trade-off** : Latence +1-2s mais zéro problème

### 🔧 Gestion BUFFER_APPENDING Issues

```typescript
hls.on(Hls.Events.BUFFER_APPENDING, (event, data) => {
  // Surveillance timestamps/corruption
  // HLS.js gère automatiquement la plupart des cas
});
```

**Erreurs communes gérées par HLS.js** :
- PTS discontinuity → Remux automatique
- Audio/Video desync → Resync automatique
- Corrupted packets → Skip + continue

---

## 6️⃣ MAINTENANCE LONG-TERME & MONITORING

### 🧠 Concept : Auto-Healing Préventif

Pour lectures >1h, le player doit :
1. **Nettoyer mémoire** (éviter leaks)
2. **Vérifier qualité** (frames perdus)
3. **Détecter gels** (manifest gelé)

### ⚙️ Maintenance Implémentée (tous les 15 min)

```typescript
setInterval(() => {
  // 1. Vérifier qualité playback
  const quality = video.getVideoPlaybackQuality();
  const dropRate = quality.droppedVideoFrames / quality.totalVideoFrames;
  
  if (dropRate > 8%) {
    hls.recoverMediaError(); // Soft recovery
  }
  
  // 2. Cleanup buffer si >180s
  const totalBuffered = bufferEnd - bufferStart;
  if (totalBuffered > 180s) {
    hls.stopLoad();
    hls.startLoad(currentTime - 10s); // Garder 10s arrière
  }
  
  // 3. Détecter manifest gelé
  const timeSinceLastLoad = Date.now() - lastManifestLoadTime;
  if (timeSinceLastLoad > 120s) {
    hls.startLoad(currentTime); // Force reload manifest
  }
}, 15 * 60 * 1000); // 15 minutes
```

### 📊 Seuils de Santé

| Métrique | Seuil Normal | Seuil Critique | Action |
|----------|-------------|----------------|--------|
| Dropped frames | <5% | >8% | recoverMediaError() |
| Buffer size | <180s | >180s | Cleanup forcé |
| Manifest age | <120s | >120s | Force reload |
| Live latency | <60s | >120s | Seek direct |

---

## 7️⃣ CHECKLIST TESTS PRODUCTION

### Tests Basiques
- [ ] **VLC test** : Ouvrir URL dans VLC (doit lire sans problème)
- [ ] **30min continu** : Zéro coupure, zéro saccade
- [ ] **5+ switches chaînes** : Transitions fluides (<500ms)
- [ ] **Mobile 4G** : Lecture stable >1h sur réseau mobile

### Tests Stress
- [ ] **Slow 3G** : Chrome DevTools → Throttling → Stable ?
- [ ] **Packet loss** : 5% loss simulé → Recovery auto ?
- [ ] **Suspend/Resume** : App en background → Retour → Reprend ?
- [ ] **Memory** : Chrome Task Manager → Pas de leak sur 2h ?

### Tests Long-Terme
- [ ] **2h lecture** : Zéro freeze, zéro écran noir
- [ ] **6h lecture** : Memory stable, pas de degradation
- [ ] **Switch après 2h** : Transition fluide instantanée

### Tests Live Edge
- [ ] **Latency stable** : Reste à ~30s du live (pas de dérive)
- [ ] **Network spike** : Drop connexion 10s → Rattrapage auto
- [ ] **Manifest frozen** : Simuler gel serveur → Recovery

---

## 8️⃣ MÉTRIQUES À MONITORER (Production)

### Côté Client (Analytics)

```typescript
// Envoyer à votre analytics
hls.on(Hls.Events.ERROR, (event, data) => {
  analytics.track('hls_error', {
    type: data.type,
    details: data.details,
    fatal: data.fatal,
    url: streamUrl,
    userAgent: navigator.userAgent,
    timestamp: Date.now()
  });
});

// Taux d'erreur fragments
let errorRate = fragErrorCount / totalFragCount;
if (errorRate > 0.05) alert('High error rate!'); // >5%
```

### Côté Serveur (Edge Function Logs)

**À surveiller** :
- `🔴 HLS Fatal Error` → Alerte si >10/min
- `💥 All strategies failed` → Alerte immédiate
- `🔄 Retry X/Y` → Dashboard taux retry
- `⚠️ Buffer stall` → Métriques qualité réseau

---

## 9️⃣ CONFIGURATION VOD vs LIVE

### VOD (Video on Demand)

```typescript
maxBufferLength: 180,              // Buffer plus large (pas de contrainte latence)
liveSyncDurationCount: N/A,        // Désactivé (pas de live edge)
lowLatencyMode: false,
startPosition: 0,                  // Démarrer au début
testBandwidth: true                // Mesure BP pour smart start
```

### LIVE (Flux en Direct)

```typescript
maxBufferLength: 120,              // Balance latence/stabilité
liveSyncDurationCount: 4,          // 4 segments du bord
liveMaxLatencyDurationCount: 10,
maxLiveSyncPlaybackRate: 1.08,
lowLatencyMode: false,             // Stabilité > latence minimale
startPosition: -1                  // Live edge auto
```

---

## 🔟 COMPARAISON AVEC CONFIGURATIONS POPULAIRES

### Configuration "Default" HLS.js

```typescript
maxBufferLength: 30s              // ❌ Trop court (buffering fréquent)
maxBufferHole: 0.5s               // ❌ Trop permissif (saccades)
fragLoadingMaxRetry: 6            // ⚠️ Insuffisant pour connexions instables
abrEwmaSlowLive: 9s               // ⚠️ Trop réactif (switches intempestifs)
```

### Configuration "Low Latency" HLS.js

```typescript
maxBufferLength: 10s              // ❌ Très instable (buffering constant)
lowLatencyMode: true              // ⚠️ Moins mature, bugs fréquents
liveSyncDurationCount: 1          // ❌ Trop proche live (buffering)
```

### Configuration "Stable" (NOTRE CONFIG)

```typescript
maxBufferLength: 120s             // ✅ Netflix-level
fragLoadingMaxRetry: 10           // ✅ Maximum resilience
abrEwmaSlowLive: 12s              // ✅ Switches très stables
liveSyncDurationCount: 4          // ✅ Balance idéale
```

---

## 📚 RÉFÉRENCES

- [HLS.js API Documentation](https://github.com/video-dev/hls.js/blob/master/docs/API.md)
- [Apple HLS Specification](https://datatracker.ietf.org/doc/html/rfc8216)
- [Video.js HLS Best Practices](https://videojs.com/guides/hls/)
- [Netflix Tech Blog - ABR Algorithm](https://netflixtechblog.com/)
- [YouTube Engineering - Live Streaming](https://youtube-eng.googleblog.com/)

---

**Version** : 2.0.0  
**Dernière mise à jour** : 2025-01-27  
**Auteur** : Configuration professionnelle basée sur best practices industrie
