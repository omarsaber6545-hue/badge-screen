import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const libDir = path.resolve('lib');
const libmvecSource = path.join(libDir, 'libmvec.so.1');

if (process.platform === 'linux' && fs.existsSync(libmvecSource)) {
    console.log('[System] Linux detected. Ensuring libmvec.so.1 is configured...');
    const nodeAvTargets = [
        path.resolve('node_modules/@seydx/node-av-linux-x64/libmvec.so.1'),
        '/app/node_modules/@seydx/node-av-linux-x64/libmvec.so.1',
        '/lib/libmvec.so.1',
        '/usr/lib/libmvec.so.1'
    ];

    for (const target of nodeAvTargets) {
        try {
            const dir = path.dirname(target);
            if (fs.existsSync(dir) && !fs.existsSync(target)) {
                fs.copyFileSync(libmvecSource, target);
                console.log(`[Auto-Fix] Linked libmvec.so.1 to ${target}`);
            }
        } catch {}
    }
}

// Pass LD_LIBRARY_PATH so dynamic linker picks up lib/
const env = {
    ...process.env,
    LD_LIBRARY_PATH: `${process.env.LD_LIBRARY_PATH || ''}:${libDir}:/app/lib:/usr/local/lib:/usr/lib:/lib`
};

const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(cmd, ['tsx', 'src/bot.ts'], {
    stdio: 'inherit',
    env
});

child.on('exit', (code) => {
    process.exit(code || 0);
});
