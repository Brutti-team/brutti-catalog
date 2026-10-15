import { backendConfig } from './backend-config.mjs';
import { inspectBackend } from './inspect-backend.mjs';

try {
  const result = await inspectBackend(backendConfig());
  if (!result.requiredReadsPassed)
    throw new Error('Production build configuration did not pass existing-project public-data checks.');
  console.log('Public build configuration verified against the existing Brutti project. Admin, Storage, full RLS and deployment approval remain separate gates.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
