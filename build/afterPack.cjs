// Ad-hoc code signature for the packaged app (no Developer ID is available).
// Apple Silicon refuses to run unsigned code; an ad-hoc signature satisfies
// that requirement but is NOT a Developer ID signature and NOT notarized, so
// Gatekeeper asks the user to confirm the first launch (see docs/INSTALL.md).
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
};
