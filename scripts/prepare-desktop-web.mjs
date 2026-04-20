import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'src-tauri', 'resources', 'web');
const standaloneDir = path.join(root, '.next', 'standalone');
const staticDir = path.join(root, '.next', 'static');
const publicDir = path.join(root, 'public');

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(path.join(outDir, '.next'), { recursive: true });

await fs.cp(standaloneDir, outDir, { recursive: true });
await fs.cp(staticDir, path.join(outDir, '.next', 'static'), { recursive: true });
await fs.cp(publicDir, path.join(outDir, 'public'), { recursive: true });

console.log(`Desktop web bundle prepared at ${outDir}`);
