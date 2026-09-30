import { mkdtempSync, rmSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeWritable(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) makeWritable(p);
    else chmodSync(p, 0o644);
  }
}

export function tempDir(prefix = 'atelier-test-'): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return {
    path,
    cleanup: () => {
      try {
        makeWritable(path);
      } catch {
        // ignore
      }
      rmSync(path, { recursive: true, force: true });
    },
  };
}
