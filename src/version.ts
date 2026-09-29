import { readFileSync } from 'node:fs';
import { z } from 'zod';

const manifest = z.object({ name: z.string(), version: z.string() }).parse(
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
);
export const packageName = manifest.name;
export const version = manifest.version;
export const protocolVersion = 1;
