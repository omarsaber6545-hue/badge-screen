import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const libDir = path.resolve('lib');
const libmvecSource = path.join(libDir, 'libmvec.so.1');
const libchkSource = path.join(libDir, 'libchk.so');

let preloads = [];
if (process.platform === 'linux') {
    console.log('[System] Linux detected. Initializing binary shims for libmvec and glibc symbols...');
    
    if (fs.existsSync(libchkSource)) {
        preloads.push(libchkSource);
    }
    if (fs.existsSync(libmvecSource)) {
        preloads.push(libmvecSource);
    }

    const nodeAvDirs = [
        path.resolve('node_modules/@seydx/node-av-linux-x64'),
        '/app/node_modules/@seydx/node-av-linux-x64',
        '/lib',
        '/usr/lib'
    ];

    for (const dir of nodeAvDirs) {
        try {
            if (fs.existsSync(dir)) {
                if (fs.existsSync(libmvecSource)) {
                    fs.copyFileSync(libmvecSource, path.join(dir, 'libmvec.so.1'));
                }
                if (fs.existsSync(libchkSource)) {
                    fs.copyFileSync(libchkSource, path.join(dir, 'libchk.so'));
                }
                console.log(`[Auto-Fix] Deployed shims to ${dir}`);
            }
        } catch {}
    }
}

// Configure LD_PRELOAD and LD_LIBRARY_PATH
const env = {
    ...process.env,
    LD_PRELOAD: preloads.length > 0 
        ? `${preloads.join(':')}${process.env.LD_PRELOAD ? `:${process.env.LD_PRELOAD}` : ''}`
        : process.env.LD_PRELOAD,
    LD_LIBRARY_PATH: `${process.env.LD_LIBRARY_PATH || ''}:${libDir}:/app/lib:/usr/local/lib:/usr/lib:/lib`
};

if (process.platform === 'linux') {
    console.log(`[System] Active LD_PRELOAD: ${env.LD_PRELOAD}`);
}

const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(cmd, ['tsx', 'src/bot.ts'], {
    stdio: 'inherit',
    env
});

child.on('exit', (code) => {
    process.exit(code || 0);
});
