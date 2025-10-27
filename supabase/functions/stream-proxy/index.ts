import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, range',
  'Access-Control-Expose-Headers': 'content-length, content-type, content-range, accept-ranges',
};

// ========== CACHE & KEEPALIVE ==========
// Connection pooling et keepalive pour réutiliser les connexions TCP
const keepAliveAgent = {
  keepAlive: true,
  keepAliveMsecs: 30000, // 30s keepalive
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000, // 60s timeout
};

// Cache pour les manifests HLS (évite de re-fetch trop souvent)
const manifestCache = new Map<string, { content: string; timestamp: number }>();
const MANIFEST_CACHE_TTL = 4000; // 4s pour manifests live

// Extract MAC address from URL
function extractMacFromUrl(url: string): string | null {
  const match = url.match(/mac=([0-9A-Fa-f:]+)/);
  return match ? match[1] : null;
}

// Generate realistic residential IP
function generateResidentialIP(): string {
  const ranges = [
    '78.', '90.', '92.', '86.', '176.', '188.',
    '82.', '84.', '91.', '109.', '217.',
  ];
  const prefix = ranges[Math.floor(Math.random() * ranges.length)];
  const octet2 = Math.floor(Math.random() * 256);
  const octet3 = Math.floor(Math.random() * 256);
  const octet4 = Math.floor(Math.random() * 256);
  return `${prefix}${octet2}.${octet3}.${octet4}`;
}

// Build IPTV player headers
function buildIPTVHeaders(streamUrl: string): Record<string, string> {
  const urlObj = new URL(streamUrl);
  const mac = extractMacFromUrl(streamUrl);
  const fakeIP = generateResidentialIP();
  
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.8',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'DNT': '1',
    'X-Forwarded-For': fakeIP,
    'X-Real-IP': fakeIP,
    'X-Client-IP': fakeIP,
    'CF-Connecting-IP': fakeIP,
    'True-Client-IP': fakeIP,
    'Origin': urlObj.origin,
    'Referer': `${urlObj.origin}/`,
    'X-User-Agent': 'Model: MAG250; Link: WiFi',
  };
  
  if (mac) {
    headers['X-MAC-Address'] = mac;
  }
  
  return headers;
}

// ========== HLS MANIFEST OPTIMIZATION ==========
// Parse et optimise le manifest HLS pour stabilité maximale
async function proxyAndOptimizeM3U8(
  content: string, 
  baseUrl: string, 
  proxyBaseUrl: string
): Promise<string> {
  const lines = content.split('\n');
  const proxiedLines: string[] = [];
  
  let targetDuration = 6; // Default 6s segments
  let isLive = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Detect live stream
    if (line.startsWith('#EXT-X-PLAYLIST-TYPE') && !line.includes('VOD')) {
      isLive = true;
    }
    
    // Extract target duration
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      const duration = parseInt(line.split(':')[1]);
      if (duration) targetDuration = duration;
    }
    
    // Optimize buffer hints for live (HLS spec)
    if (line === '#EXTM3U') {
      proxiedLines.push(line);
      // Ajouter des hints pour le player
      if (isLive) {
        proxiedLines.push('#EXT-X-ALLOW-CACHE:NO');
      }
      continue;
    }
    
    // Proxy segment URLs
    if (!line.startsWith('#') && line !== '') {
      let absoluteUrl: string;
      
      if (line.startsWith('http://') || line.startsWith('https://')) {
        absoluteUrl = line;
      } else {
        // Relative URL
        absoluteUrl = new URL(line, baseUrl).toString();
      }
      
      // Proxy through our edge function with caching hints
      proxiedLines.push(`${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}`);
      continue;
    }
    
    // Keep all other lines (tags, comments)
    proxiedLines.push(line);
  }
  
  return proxiedLines.join('\n');
}

// ========== EXPONENTIAL BACKOFF RETRY ==========
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutMs = 12000 + (attempt * 3000); // 12s, 15s, 18s, 21s
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        console.log(`✅ Fetch success on attempt ${attempt + 1}`);
        return response;
      }
      
      // Retry sur 5xx ou 429
      if (response.status >= 500 || response.status === 429) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Ne pas retry sur 4xx (sauf 429)
      return response;
      
    } catch (error) {
      lastError = error as Error;
      console.warn(`⚠️ Fetch attempt ${attempt + 1} failed:`, error);
      
      if (attempt < maxRetries) {
        // Exponential backoff: 500ms, 1s, 2s
        const delayMs = 500 * Math.pow(2, attempt);
        console.log(`🔄 Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const streamUrl = url.searchParams.get('url');
    
    if (!streamUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing url parameter' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('🎬 Proxying stream:', streamUrl);
    
    // Build headers
    const forwardHeaders = buildIPTVHeaders(streamUrl);
    
    // Forward range header
    const range = req.headers.get('range');
    if (range) {
      forwardHeaders['Range'] = range;
      console.log('📦 Range request:', range);
    }

    // ========== MULTI-STRATEGY FETCH WITH RETRY ==========
    let response: Response | null = null;
    let lastError: Error | null = null;
    
    const strategies = [
      // Strategy 1: IPTV headers with retry
      async () => {
        console.log('Strategy 1: IPTV headers + retry');
        return await fetchWithRetry(streamUrl, {
          headers: forwardHeaders,
          redirect: 'follow',
        }, 3);
      },
      
      // Strategy 2: VLC-like with retry
      async () => {
        console.log('Strategy 2: VLC-like + retry');
        return await fetchWithRetry(streamUrl, {
          headers: {
            'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
            'Accept': '*/*',
            'Connection': 'keep-alive',
          },
          redirect: 'follow',
        }, 2);
      },
      
      // Strategy 3: Browser-like fallback
      async () => {
        console.log('Strategy 3: Browser fallback');
        return await fetchWithRetry(streamUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Referer': new URL(streamUrl).origin,
          },
          redirect: 'follow',
        }, 1);
      },
    ];

    for (const strategy of strategies) {
      try {
        response = await strategy();
        if (response.ok) {
          console.log('✅ Strategy succeeded:', response.status);
          break;
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        console.error('❌ Strategy failed:', error);
        lastError = error as Error;
        response = null;
      }
    }

    if (!response || !response.ok) {
      console.error('💥 All strategies failed:', lastError?.message);
      
      return new Response(
        JSON.stringify({ 
          error: 'Stream inaccessible',
          details: lastError?.message || 'All strategies failed',
          info: 'Source indisponible ou authentification requise'
        }),
        { 
          status: 502, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const contentType = response.headers.get('content-type') || '';
    console.log('📄 Content-Type:', contentType);
    
    // ========== HLS MANIFEST HANDLING ==========
    if (contentType.includes('application/vnd.apple.mpegurl') || 
        contentType.includes('application/x-mpegURL') ||
        streamUrl.includes('.m3u8')) {
      
      console.log('🎭 HLS manifest detected');
      
      // Check cache first
      const cached = manifestCache.get(streamUrl);
      const now = Date.now();
      
      if (cached && (now - cached.timestamp) < MANIFEST_CACHE_TTL) {
        console.log('⚡ Returning cached manifest');
        return new Response(cached.content, {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'X-Cache': 'HIT',
          },
        });
      }
      
      // Parse and optimize manifest
      const playlistContent = await response.text();
      const baseUrl = streamUrl.substring(0, streamUrl.lastIndexOf('/') + 1);
      const proxyBaseUrl = `${url.origin}${url.pathname}`;
      
      const optimizedPlaylist = await proxyAndOptimizeM3U8(
        playlistContent, 
        baseUrl, 
        proxyBaseUrl
      );
      
      // Update cache
      manifestCache.set(streamUrl, {
        content: optimizedPlaylist,
        timestamp: now,
      });
      
      // Cleanup old cache entries (max 100)
      if (manifestCache.size > 100) {
        const oldestKeys = Array.from(manifestCache.keys()).slice(0, 20);
        oldestKeys.forEach(key => manifestCache.delete(key));
      }
      
      return new Response(optimizedPlaylist, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'X-Cache': 'MISS',
        },
      });
    }

    // ========== SEGMENT STREAMING (TS/MP4) ==========
    const responseHeaders = new Headers(corsHeaders);
    
    const headersToForward = [
      'content-type', 'content-length', 'content-range', 
      'accept-ranges', 'cache-control', 'transfer-encoding'
    ];
    
    headersToForward.forEach(header => {
      const value = response.headers.get(header);
      if (value) {
        responseHeaders.set(header, value);
      }
    });
    
    // Ajouter cache pour les segments (immutables)
    if (streamUrl.includes('.ts') || streamUrl.includes('.m4s')) {
      responseHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
    }

    console.log('📺 Streaming response');

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('💥 Proxy error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        type: error instanceof Error ? error.name : 'UnknownError',
        info: 'Erreur proxy IPTV'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
