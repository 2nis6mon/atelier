// Optional, user-triggered conversion of a .pages file to .docx using the
// Pages app installed on this Mac (AppleScript "export … as Microsoft Word").
// macOS asks the user to allow Atelier to control Pages the first time.
// Paths are passed as script arguments, never interpolated into the script.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Runner = (file: string, args: string[], opts: { timeout: number }) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: Runner = (file, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: opts.timeout }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });

export function pagesAppPath(platform = process.platform, exists = existsSync): string | null {
  if (platform !== 'darwin') return null;
  for (const p of ['/Applications/Pages.app', join(homedir(), 'Applications', 'Pages.app')]) if (exists(p)) return p;
  return null;
}

export const PAGES_EXPORT_SCRIPT = [
  'on run argv',
  'set inFile to POSIX file (item 1 of argv)',
  'set outFile to POSIX file (item 2 of argv)',
  'tell application id "com.apple.iWork.Pages"',
  'set theDoc to open inFile',
  'export theDoc to outFile as Microsoft Word',
  'close theDoc saving no',
  'end tell',
  'end run',
];

export class PagesConversionError extends Error {
  constructor(
    message: string,
    readonly reason: 'unavailable' | 'denied' | 'failed',
  ) {
    super(message);
    this.name = 'PagesConversionError';
  }
}

export async function convertPagesToDocx(input: string, output: string, run: Runner = defaultRunner, appPath = pagesAppPath()): Promise<void> {
  if (!appPath) throw new PagesConversionError('Pages is not installed on this Mac.', 'unavailable');
  const args = PAGES_EXPORT_SCRIPT.flatMap((line) => ['-e', line]).concat([input, output]);
  try {
    await run('/usr/bin/osascript', args, { timeout: 120_000 });
  } catch (e) {
    const stderr = String((e as { stderr?: string }).stderr ?? '');
    if (/-1743|not authori[sz]ed|Not authorised/i.test(stderr)) {
      throw new PagesConversionError('Atelier is not allowed to control Pages. Allow it in System Settings › Privacy & Security › Automation.', 'denied');
    }
    throw new PagesConversionError('Pages could not export this document.', 'failed');
  }
  if (!existsSync(output)) throw new PagesConversionError('Pages did not produce a Word file.', 'failed');
}
