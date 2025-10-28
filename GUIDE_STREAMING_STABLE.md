# 🎯 GUIDE : Migrer vers un Streaming Ultra-Stable

## 📋 Pourquoi cette migration ?

**Problème actuel :** Vous streamez directement depuis des serveurs IPTV (`http://drmv3-m6.info`, `http://eagle2024.xyz`). Cela crée :
- ❌ Buffering aléatoire (serveurs IPTV instables)
- ❌ Pas d'adaptation qualité (toujours FHD = 8-15 Mbps)
- ❌ Latence variable selon la localisation de l'utilisateur
- ❌ Risque de coupure si le serveur IPTV tombe

**Solution professionnelle :** Utiliser un service de streaming qui :
- ✅ Transcoder vos flux en ABR (Adaptive Bitrate Streaming)
- ✅ Distribuer via CDN mondial (latence minimale partout)
- ✅ Gérer les erreurs et reconnexions automatiquement
- ✅ Garantir 99.9% uptime

---

## 🚀 Option 1 : Mux (RECOMMANDÉ - Le plus simple)

### Pourquoi Mux ?
- ✅ API ultra-simple, setup en 10 minutes
- ✅ Transcodage ABR automatique (5 qualités : 360p → 1080p)
- ✅ CDN mondial inclus (AWS CloudFront)
- ✅ Support HLS + MPEG-DASH
- ✅ Latence live : 6-10 secondes

### Pricing
- **$0.05 par GB** diffusé
- **$0.005 par minute** de transcodage
- Exemple : 1000 vues de 2h chaque = ~$50-100/mois

### Setup Mux

#### Étape 1 : Créer un compte
1. Aller sur https://mux.com/
2. Créer un compte (pas de carte bancaire pour tester)
3. Créer une "Live Stream" dans le dashboard

#### Étape 2 : Configurer votre stream
```bash
# Dans le dashboard Mux, créer un "Live Stream"
# Vous obtiendrez :
- Stream Key : stream_key_xxxxx
- Playback URL : https://stream.mux.com/{PLAYBACK_ID}.m3u8
```

#### Étape 3 : Router votre flux IPTV vers Mux
**Option A : Via OBS Studio (recommandé pour débuter)**
```
1. Télécharger OBS Studio (gratuit)
2. Sources → Media Source → Coller votre URL IPTV
3. Paramètres → Stream :
   - Service : Custom
   - Server : rtmps://global-live.mux.com:443/app
   - Stream Key : [votre stream key Mux]
4. Démarrer le streaming
```

**Option B : Via FFmpeg (pour automatiser)**
```bash
ffmpeg -i "http://drmv3-m6.info:80/play/live.php?mac=00:1A:79:84:1A:60&stream=250665&extension=ts" \
  -c:v copy -c:a copy \
  -f flv rtmps://global-live.mux.com:443/app/[STREAM_KEY]
```

#### Étape 4 : Mettre à jour votre code Lovable
```typescript
// Dans src/pages/Index.tsx, remplacer les URLs :
const PREDEFINED_CHANNELS = [
  {
    name: "Eurosport 1 FHD",
    url: "https://stream.mux.com/YOUR_PLAYBACK_ID_1.m3u8" // ← URL Mux
  },
  {
    name: "Eurosport 2 FHD",
    url: "https://stream.mux.com/YOUR_PLAYBACK_ID_2.m3u8"
  },
  // ... etc
];
```

✅ **C'est tout !** Votre player utilisera les flux Mux ABR automatiquement.

---

## ⚡ Option 2 : Cloudflare Stream

### Pourquoi Cloudflare Stream ?
- ✅ Edge CDN le plus rapide au monde (200+ villes)
- ✅ Transcodage ABR automatique
- ✅ Latence live : 4-8 secondes (meilleur que Mux)
- ✅ Intégration avec Cloudflare Workers (si besoin API custom)

### Pricing
- **$1 par 1000 minutes** de visionnage
- **$5 par 1000 GB** de bande passante
- Exemple : 1000 vues de 2h = ~$120/mois

### Setup Cloudflare Stream

#### Étape 1 : Créer un compte
1. Aller sur https://dash.cloudflare.com/
2. Créer un compte → Stream → Créer un "Live Input"

#### Étape 2 : Obtenir vos URLs
```bash
# Dans Cloudflare Stream Dashboard :
- RTMPS URL : rtmps://live.cloudflare.com:443/live/
- Stream Key : [généré automatiquement]
- Playback URL : https://customer-xxxxx.cloudflarestream.com/{UID}/manifest/video.m3u8
```

#### Étape 3 : Router votre flux IPTV
**Via FFmpeg :**
```bash
ffmpeg -i "http://drmv3-m6.info:80/play/live.php?mac=00:1A:79:84:1A:60&stream=250665&extension=ts" \
  -c:v libx264 -preset veryfast -b:v 4M \
  -c:a aac -b:a 128k \
  -f flv rtmps://live.cloudflare.com:443/live/[STREAM_KEY]
```

#### Étape 4 : Mettre à jour votre code Lovable
```typescript
// Dans src/pages/Index.tsx :
const PREDEFINED_CHANNELS = [
  {
    name: "Eurosport 1 FHD",
    url: "https://customer-xxxxx.cloudflarestream.com/[UID]/manifest/video.m3u8"
  },
  // ... etc
];
```

---

## 🏢 Option 3 : AWS MediaLive (Entreprise)

### Pourquoi AWS ?
- ✅ Solution la plus puissante et scalable
- ✅ Latence ultra-faible possible (2-5s)
- ✅ Support CMAF, HLS, DASH, MSS
- ✅ Contrôle total sur le transcodage

### Pricing
- **Complexe** : ~$150-500/mois selon utilisation
- Nécessite expertise AWS (CloudFormation, MediaPackage, CloudFront)

### Setup (simplifié)
1. **AWS MediaLive** : Créer un "Channel" pour chaque flux IPTV
2. **AWS MediaPackage** : Créer un "Channel" pour packaging HLS
3. **CloudFront** : Créer une distribution CDN
4. Router vos flux IPTV vers MediaLive via RTMP

**⚠️ Recommandation :** Seulement si vous avez déjà une infrastructure AWS.

---

## 📊 Comparaison Rapide

| Critère | Mux | Cloudflare Stream | AWS MediaLive |
|---------|-----|-------------------|---------------|
| **Simplicité** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **Prix** | $50-100/mois | $120/mois | $150-500/mois |
| **Latence** | 6-10s | 4-8s | 2-5s |
| **Setup Time** | 10 min | 20 min | 2-4h |
| **Qualité ABR** | Excellent | Excellent | Excellent |
| **Uptime** | 99.9% | 99.99% | 99.99% |

---

## 🎯 Ma Recommandation

**Pour votre cas (streaming TV sportif) :**

### 🥇 Commencez par Mux
- Setup ultra-rapide (10 minutes)
- Test gratuit pour valider
- Vous gardez votre code actuel (juste changer les URLs)
- Si ça marche, vous économisez des heures de config

### 🥈 Si vous avez besoin de latence minimale
- Migrez vers Cloudflare Stream
- Latence ~5s (idéal pour paris sportifs live)

### 🥉 AWS seulement si
- Vous avez déjà une infra AWS
- Budget > $500/mois
- Besoin de features custom (mid-roll ads, DRM, etc.)

---

## 🚀 Action Immédiate

**Je vous recommande de faire ceci MAINTENANT :**

1. **Créer un compte Mux** (gratuit, pas de CB) → https://mux.com/
2. **Créer 1 live stream** de test
3. **Router 1 seul de vos flux IPTV** (Eurosport 1 par exemple) via OBS
4. **Tester dans votre app** en changeant juste 1 URL dans `PREDEFINED_CHANNELS`

**⏱️ Temps total : 15 minutes**

Si ça fonctionne bien (ça devrait), vous migrez les 10 autres chaînes progressivement.

---

## ❓ Questions Fréquentes

**Q: Dois-je garder mes URLs IPTV actuelles ?**
R: Oui, en tant que backup. Vous pouvez même créer un système de fallback (si Mux fail → IPTV direct).

**Q: Est-ce que mes publicités VAST fonctionneront encore ?**
R: Oui ! Le nouveau player Video.js + IMA que j'ai créé fonctionne parfaitement avec les URLs Mux/Cloudflare.

**Q: Combien de temps pour migrer tout ?**
R: 1 chaîne = 5 minutes. Donc 10 chaînes = 1 heure maximum.

**Q: Et si je veux tester sans payer ?**
R: Mux offre un essai gratuit. Cloudflare aussi jusqu'à 1000 minutes.

---

## 📞 Support

Si vous avez des questions sur la migration, demandez-moi !
Je peux vous aider à :
- Créer le script FFmpeg pour automatiser
- Setup un système de fallback IPTV → Mux
- Monitorer la santé de vos streams
