import { isIP } from 'node:net';
import { defineConfig, loadEnv } from 'vite';

function normalizePublicSiteUrl(value) {
  if (!value?.trim()) return '';
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('PUBLIC_SITE_URL must be an absolute HTTPS origin, such as the final public domain.');
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !hostname.includes('.') || isIP(hostname)
    || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
    || hostname.endsWith('.test') || hostname.endsWith('.invalid') || hostname.endsWith('.example')
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_SITE_URL must be the production HTTPS origin only; local, IP, test, and path URLs are not allowed.');
  }
  return url.origin.replace(/\/$/, '');
}

function normalizePublicBackendUrl(value, mode) {
  if (!value?.trim()) return '';
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('PUBLIC_BACKEND_URL must be an absolute HTTPS origin for production.');
  }
  const hostname = url.hostname.toLowerCase();
  const isLocalAddress = isIP(hostname) !== 0 || hostname === 'localhost' || hostname.endsWith('.localhost')
    || hostname.endsWith('.local') || hostname.endsWith('.test') || hostname.endsWith('.invalid');
  const validProtocol = mode === 'production' ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol);
  if (!validProtocol || (mode === 'production' && (isLocalAddress || !hostname.includes('.')))
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(mode === 'production'
      ? 'PUBLIC_BACKEND_URL must be a public HTTPS origin only; local, IP, and path URLs are not allowed.'
      : 'PUBLIC_BACKEND_URL must be an HTTP(S) origin only, with no path, query, or fragment.');
  }
  return url.origin.replace(/\/$/, '');
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function robotsText(siteUrl) {
  return `User-agent: *\nAllow: /\n${siteUrl ? `Sitemap: ${siteUrl}/sitemap.xml\n` : ''}`;
}

function sitemapXml(siteUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${escapeXml(siteUrl)}/</loc></url>\n</urlset>\n`;
}

function publicSeoPlugin(siteUrl) {
  const markerStart = '<!-- SITE_URL_METADATA_START -->';
  const markerEnd = '<!-- SITE_URL_METADATA_END -->';
  const robots = robotsText(siteUrl);
  const sitemap = siteUrl ? sitemapXml(siteUrl) : '';
  return {
    name: 'public-site-seo',
    transformIndexHtml(html) {
      const start = html.indexOf(markerStart);
      const end = html.indexOf(markerEnd);
      if (start < 0 || end < start) throw new Error('Public URL metadata markers are missing from index.html.');
      if (!siteUrl) return `${html.slice(0, start)}${html.slice(end + markerEnd.length)}`;
      const block = html.slice(start + markerStart.length, end).replaceAll('__PUBLIC_SITE_URL__', siteUrl);
      return `${html.slice(0, start)}${block}${html.slice(end + markerEnd.length)}`;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://vite.local').pathname;
        if (pathname === '/robots.txt') {
          response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          response.end(robots);
          return;
        }
        if (pathname === '/sitemap.xml') {
          if (!siteUrl) {
            response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
            response.end('Set PUBLIC_SITE_URL to the public HTTPS origin to generate the sitemap.');
            return;
          }
          response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
          response.end(sitemap);
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots });
      if (siteUrl) this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const publicSiteUrl = normalizePublicSiteUrl(env.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || '');
  const publicBackendUrl = normalizePublicBackendUrl(
    env.PUBLIC_BACKEND_URL || env.VITE_SERVER_URL || process.env.PUBLIC_BACKEND_URL || process.env.VITE_SERVER_URL || '',
    mode,
  );
  const riftServerUrl = env.RIFT_SERVER_URL || process.env.RIFT_SERVER_URL || 'http://localhost:3001';
  return {
    define: { 'import.meta.env.PUBLIC_BACKEND_URL': JSON.stringify(publicBackendUrl) },
    plugins: [publicSeoPlugin(publicSiteUrl)],
    server: {
      watch: {
        ignored: ['**/.icon-import-stage/**'],
      },
      proxy: {
        '/ws': { target: riftServerUrl.replace(/^http/, 'ws'), ws: true },
      },
    },
  };
});
