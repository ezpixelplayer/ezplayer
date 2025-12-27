// scripts/dev-with-port.mjs
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const electronAppRoot = join(__dirname, '..');

function promptPort() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        rl.question('Enter the port number for the React web server (default: 3000): ', (answer) => {
            rl.close();
            const port = answer.trim() || '3000';
            const portNum = parseInt(port, 10);

            if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
                console.error(`❌ Invalid port number: ${port}. Using default port 3000.`);
                resolve(3000);
            } else {
                console.log(`✅ Using port ${portNum} for the React web server\n`);
                resolve(portNum);
            }
        });
    });
}

async function main() {
    const port = await promptPort();

    // Set the React web server (Koa) port as an environment variable
    process.env.EZPLAYER_WEB_PORT = port.toString();

    // Change to the electron app root directory
    process.chdir(electronAppRoot);

    // Run the dev:direct script with the port set
    const devProcess = spawn('pnpm', ['dev:direct'], {
        stdio: 'inherit',
        shell: true,
        env: process.env,
    });

    devProcess.on('error', (err) => {
        console.error('Failed to start dev server:', err);
        process.exit(1);
    });

    devProcess.on('exit', (code) => {
        process.exit(code || 0);
    });
}

main().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
});
