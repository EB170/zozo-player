import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, range',
  'Access-Control-Expose-Headers': 'content-length, content-type, content-range, accept-ranges',
};

// Session cache to maintain cookies across requests
const sessionCache = new Map<string, { cookies: string[], timestamp: number }>();
const SESSION_LIFETIME = 3600000; // 1 hour

// Extract cookies from response
function extractCookies(response: Response): string[] {
  const cookies: string[] = [];
  const setCookieHeaders = response.headers.get('set-cookie');
  if (setCookieHeaders) {
    cookies.push(setCookieHeaders);
  }
  return cookies;
}

// Build comprehensive browser-like headers
function buildBrowserHeaders(streamUrl: string, cookies?: string[]): Record<string, string> {
  const urlObj = new URL(streamUrl);
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
    'Origin': urlObj.origin,
    'Referer': urlObj.origin + '/',
    'Sec-Fetch-Dest': 'video',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };

  if (cookies && cookies.length > 0) {
    headers['Cookie'] = cookies.join('; ');
  }

  return headers;
}

// Establish session by making initial request to the origin
async function establishSession(streamUrl: string): Promise<string[]> {
  const urlObj = new URL(streamUrl);
  const originUrl = `${urlObj.protocol}//${urlObj.host}`;
  
  console.log('Establishing session with origin:', originUrl);
  
  try {
    const response = await fetch(originUrl, {
      headers: buildBrowserHeaders(originUrl),
      redirect: 'follow',
    });
    
    const cookies = extractCookies(response);
    console.log('Session established, cookies:', cookies.length);
    return cookies;
  } catch (error) {
    console.error('Failed to establish session:', error);
    return [];
  }
}

// Get or create session for a domain
async function getSession(streamUrl: string): Promise<string[]> {
  const urlObj = new URL(streamUrl);
  const domain = urlObj.host;
  
  // Check cache
  const cached = sessionCache.get(domain);
  const now = Date.now();
  
  if (cached && (now - cached.timestamp) < SESSION_LIFETIME) {
    console.log('Using cached session for domain:', domain);
    return cached.cookies;
  }
  
  // Establish new session
  const cookies = await establishSession(streamUrl);
  sessionCache.set(domain, { cookies, timestamp: now });
  
  return cookies;
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

    console.log('Proxying stream:', streamUrl);

    // Get session cookies
    const cookies = await getSession(streamUrl);
    
    // Build request headers
    const forwardHeaders = buildBrowserHeaders(streamUrl, cookies);
    
    // Forward range header if present
    const range = req.headers.get('range');
    if (range) {
      forwardHeaders['Range'] = range;
    }

    console.log('Fetching stream with headers:', Object.keys(forwardHeaders));

    // Fetch with extended timeout and follow redirects
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const response = await fetch(streamUrl, {
      headers: forwardHeaders,
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    // Update session cookies if new ones are provided
    const newCookies = extractCookies(response);
    if (newCookies.length > 0) {
      const urlObj = new URL(streamUrl);
      const domain = urlObj.host;
      sessionCache.set(domain, { cookies: newCookies, timestamp: Date.now() });
      console.log('Updated session cookies for domain:', domain);
    }

    if (!response.ok) {
      console.error('Stream fetch failed:', response.status, response.statusText);
      
      // If 502, try one more time with fresh session
      if (response.status === 502) {
        console.log('Got 502, clearing session and retrying...');
        const urlObj = new URL(streamUrl);
        sessionCache.delete(urlObj.host);
        
        // Retry with new session
        const freshCookies = await getSession(streamUrl);
        const retryHeaders = buildBrowserHeaders(streamUrl, freshCookies);
        if (range) retryHeaders['Range'] = range;
        
        const retryResponse = await fetch(streamUrl, {
          headers: retryHeaders,
          redirect: 'follow',
        });
        
        if (!retryResponse.ok) {
          return new Response(
            JSON.stringify({ 
              error: 'Stream unavailable after retry',
              status: retryResponse.status,
              statusText: retryResponse.statusText
            }),
            { 
              status: retryResponse.status, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          );
        }
        
        // Use retry response
        const responseHeaders = new Headers(corsHeaders);
        const headersToForward = [
          'content-type', 'content-length', 'content-range', 
          'accept-ranges', 'cache-control', 'transfer-encoding'
        ];
        
        headersToForward.forEach(header => {
          const value = retryResponse.headers.get(header);
          if (value) responseHeaders.set(header, value);
        });

        return new Response(retryResponse.body, {
          status: retryResponse.status,
          headers: responseHeaders,
        });
      }
      
      return new Response(
        JSON.stringify({ 
          error: 'Failed to fetch stream',
          status: response.status,
          statusText: response.statusText
        }),
        { 
          status: response.status, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Forward successful response
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

    console.log('Streaming response, content-type:', response.headers.get('content-type'));

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        type: error instanceof Error ? error.name : 'UnknownError'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
