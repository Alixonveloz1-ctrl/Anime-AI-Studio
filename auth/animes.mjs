import { protectPage, showSessionError } from './client.mjs';
protectPage().catch(showSessionError);
