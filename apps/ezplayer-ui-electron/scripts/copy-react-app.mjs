// scripts/copy-react-app.mjs
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths relative to this script file
const electronAppRoot = join(__dirname, '..');
const reactAppDist = join(electronAppRoot, '../ezplayer-ui-react/dist');
const electronDist = join(electronAppRoot, 'dist');
const targetPath = join(electronDist, 'react-web');

console.log('📦 Copying React app build to Electron dist...');
console.log(`   Source: ${reactAppDist}`);
console.log(`   Target: ${targetPath}`);

if (!existsSync(reactAppDist)) {
    console.error(`❌ Error: React app dist folder not found at ${reactAppDist}`);
    console.error('   Please build ezplayer-ui-react first: pnpm --filter ezplayer-ui-react build');
    process.exit(1);
}

if (!existsSync(electronDist)) {
    console.log(`   Creating dist directory: ${electronDist}`);
    mkdirSync(electronDist, { recursive: true });
}

try {
    // Remove existing react-web folder if it exists
    if (existsSync(targetPath)) {
        rmSync(targetPath, { recursive: true, force: true });
    }

    // Copy the entire react app dist folder
    cpSync(reactAppDist, targetPath, { recursive: true });
    console.log('✅ Successfully copied React app build');
} catch (error) {
    console.error('❌ Error copying React app:', error.message);
    process.exit(1);
}
