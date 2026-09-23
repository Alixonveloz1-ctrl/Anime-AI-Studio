import { handleShortsRequest } from './shorts/gateway.mjs';
import { pageGate } from './auth/gate.mjs';

// Both sections share a private entrance. APIs independently verify the owner.
export const config = { matcher: ['/', '/index', '/index.html', '/cortos', '/cortos/', '/cortos/index', '/cortos/index.html', '/api/shorts'], runtime: 'edge' };

export default function middleware(request) {
  if (new URL(request.url).pathname !== '/api/shorts') return pageGate(request);
  return handleShortsRequest(request, {
    SHORTS_ENABLED: process.env.SHORTS_ENABLED,
    SHORTS_PRODUCTION_URL: process.env.SHORTS_PRODUCTION_URL,
    SHORTS_FIREBASE_WEB_CONFIG: process.env.SHORTS_FIREBASE_WEB_CONFIG,
    SHORTS_ENVIRONMENT: process.env.SHORTS_ENVIRONMENT,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });
}
