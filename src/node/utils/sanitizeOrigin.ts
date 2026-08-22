'use strict';

/**
 * Strict validation of the host and origin strings that get echoed into
 * server-rendered output (Open Graph/Twitter Card meta tags, OpenAPI
 * `servers[].url`). These strings may be derived from client-controlled request
 * headers (Host, X-Forwarded-Host, X-Forwarded-Proto), so they must be
 * validated before being emitted to prevent header injection, open redirects,
 * and other non-DNS-character garbage.
 */

// Strict hostname[:port] pattern. Rejects header injection (\r\n), userinfo
// (user@host), wildcards, and any non-DNS-character garbage. Length-capped so
// a giant Host header can't blow up the response.
const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,253}[a-z0-9])?(:\d{1,5})?$/i;

/**
 * Validates a Host header value, returning it unchanged, or null when invalid.
 */
export const sanitizeHost = (host: string | undefined): string | null => {
  if (!host || host.length > 255) return null;
  return HOST_RE.test(host) ? host : null;
};

/**
 * Validates a configured public URL (e.g. `settings.publicURL`). It must be
 * `http(s)://host[:port]` with no path, query string, or fragment. Returns the
 * normalized origin (lowercased scheme, trailing slash stripped), or null when
 * invalid.
 */
export const sanitizePublicURL = (raw: string | null | undefined): string | null => {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.replace(/\/+$/, '').match(/^(https?):\/\/([^/?#]+)$/i);
  if (!m) return null;
  return sanitizeHost(m[2]) ? `${m[1].toLowerCase()}://${m[2]}` : null;
};
