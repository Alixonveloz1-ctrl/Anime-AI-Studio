import { protectPage, showSessionError } from './client.mjs';
protectPage(() => window.dispatchEvent(new Event('studio-access-ready'))).catch(showSessionError);
