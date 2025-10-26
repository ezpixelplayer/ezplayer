const fs = require('fs');
const path = require('path');

function findNapiDir() {
  // Resolve napi.h, then go to its directory
  const hdr = require.resolve('node-addon-api/napi.h');
  return path.dirname(hdr);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const src = findNapiDir();
const dst = path.join(process.cwd(), 'deps', 'node-addon-api');
copyDir(src, dst);
console.log('Copied node-addon-api headers to', dst);
