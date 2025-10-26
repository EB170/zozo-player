import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, range',
  'Access-Control-Expose-Headers': 'content-length, content-type, content-range, accept-ranges',
};

// Extract MAC address from URL
function extractMacFromUrl(url: string): string | null {
  const match = url.match(/mac=([0-9A-Fa-f:]+)/);
  return match ? match[1] : null;
}

// Generate realistic residential IP
function generateResidentialIP(): string {
  // Common residential IP ranges
  const ranges = [
    '78.', '90.', '92.', '86.', '176.', '188.', // European ISP ranges
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
    // Simulate IPTV STB (Set-Top-Box) player
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.8',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'DNT': '1',
    
    // IPTV specific headers
    'X-Forwarded-For': fakeIP,
    'X-Real-IP': fakeIP,
    'X-Client-IP': fakeIP,
    'CF-Connecting-IP': fakeIP,
    'True-Client-IP': fakeIP,
    
    // Origin and Referer
    'Origin': urlObj.origin,
    'Referer': `${urlObj.origin}/`,
    
    // Additional headers for MAG boxes
    'X-User-Agent': 'Model: MAG250; Link: WiFi',
  };
  
  if (mac) {
    headers['X-MAC-Address'] = mac;
  }
  
  return headers;
}

// Parse and proxy m3u8 playlist
async function proxyM3U8(content: string, baseUrl: string, proxyBaseUrl: string): Promise<string> {
  const lines = content.split('\n');
  const proxiedLines = lines.map(line => {
    // Skip comments and empty lines
    if (line.startsWith('#') || line.trim() === '') {
      return line;
    }
    
    // Proxy URLs in the playlist
    if (line.trim().startsWith('http://') || line.trim().startsWith('https://')) {
      return `${proxyBaseUrl}?url=${encodeURIComponent(line.trim())}`;
    }
    
    // Handle relative URLs
    if (!line.startsWith('#') && line.trim() !== '') {
      const absoluteUrl = new URL(line.trim(), baseUrl).toString();
      return `${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}`;
    }
    
    return line;
  });
  
  return proxiedLines.join('\n');
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

    console.log('Proxying IPTV stream:', streamUrl);
    
    // Build IPTV-specific headers
    const forwardHeaders = buildIPTVHeaders(streamUrl);
    
    // Forward range header if present
    const range = req.headers.get('range');
    if (range) {
      forwardHeaders['Range'] = range;
      console.log('Range request:', range);
    }

    console.log('Using headers:', JSON.stringify(forwardHeaders, null, 2));

    // Multiple fetch attempts with different strategies
    let response: Response | null = null;
    let lastError: Error | null = null;
    
    const strategies = [
      // Strategy 1: Direct fetch with IPTV headers
      async () => {
        console.log('Strategy 1: Direct IPTV fetch');
        return await fetch(streamUrl, {
          headers: forwardHeaders,
          redirect: 'follow',
        });
      },
      
      // Strategy 2: Minimal headers
      async () => {
        console.log('Strategy 2: Minimal headers');
        return await fetch(streamUrl, {
          headers: {
            'User-Agent': 'VLC/3.0.16 LibVLC/3.0.16',
            'Accept': '*/*',
            'Connection': 'keep-alive',
          },
          redirect: 'follow',
        });
      },
      
      // Strategy 3: Browser-like
      async () => {
        console.log('Strategy 3: Browser-like');
        return await fetch(streamUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': new URL(streamUrl).origin,
          },
          redirect: 'follow',
        });
      },
    ];

    for (const strategy of strategies) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s per attempt
        
        response = await strategy();
        clearTimeout(timeoutId);
        
        if (response.ok) {
          console.log('Success with strategy, status:', response.status);
          break;
        } else {
          console.log('Strategy failed with status:', response.status);
          lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (error) {
        console.error('Strategy error:', error);
        lastError = error as Error;
        response = null;
      }
    }

    if (!response || !response.ok) {
      const errorMessage = lastError?.message || 'All fetch strategies failed';
      console.error('All strategies failed:', errorMessage);
      
      return new Response(
        JSON.stringify({ 
          error: 'Stream inaccessible',
          details: errorMessage,
          info: 'Cette source IPTV nécessite une authentification spécifique ou est actuellement indisponible'
        }),
        { 
          status: 502, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Check content type
    const contentType = response.headers.get('content-type') || '';
    console.log('Response content-type:', contentType);
    
    // If it's a playlist, proxy the URLs in it
    if (contentType.includes('application/vnd.apple.mpegurl') || 
        contentType.includes('application/x-mpegURL') ||
        streamUrl.includes('.m3u8')) {
      console.log('Detected m3u8 playlist, proxying URLs...');
      
      const playlistContent = await response.text();
      const baseUrl = streamUrl.substring(0, streamUrl.lastIndexOf('/') + 1);
      const proxyBaseUrl = `${url.origin}${url.pathname}`;
      
      const proxiedPlaylist = await proxyM3U8(playlistContent, baseUrl, proxyBaseUrl);
      
      return new Response(proxiedPlaylist, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // Forward response headers
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

    console.log('Streaming response');

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        type: error instanceof Error ? error.name : 'UnknownError',
        info: 'Erreur lors du proxy du flux IPTV'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
