import { handleShortsRequest } from './shorts/gateway.mjs';

// Scoped to the new gateway; Animes bypasses this middleware entirely.
export const config = { matcher: '/api/shorts', runtime: 'edge' };

export default function middleware(request) {
  return handleShortsRequest(request, {
    SHORTS_ENABLED: process.env.SHORTS_ENABLED,
    SHORTS_PRODUCTION_URL: process.env.SHORTS_PRODUCTION_URL,
    SHORTS_FIREBASE_WEB_CONFIG: process.env.SHORTS_FIREBASE_WEB_CONFIG,
    SHORTS_ENVIRONMENT: process.env.SHORTS_ENVIRONMENT,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });
}
