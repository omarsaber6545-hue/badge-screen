import { Client, StageChannel } from "@lng2004/discord.js-selfbot-v13";
import { Streamer, Utils, prepareStream, playStream } from "./index.js";
import { Ytdl, chooseFormat } from "@distube/ytdl-core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

function loadConfig() {
    const envToken = process.env.DISCORD_TOKEN || process.env.TOKEN;
    const envAuthors = process.env.ACCEPTED_AUTHORS ? process.env.ACCEPTED_AUTHORS.split(",").map(s => s.trim()) : undefined;

    const possiblePaths = [
        path.resolve(process.cwd(), "config.json"),
        path.resolve(process.cwd(), "src/config.json"),
        path.resolve(process.cwd(), "examples/basic/src/config.json"),
        path.resolve(process.cwd(), "examples/basic/dist/config.json"),
        path.resolve(process.cwd(), "config.example.json")
    ];

    let fileConfig: any = {};
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            try {
                fileConfig = JSON.parse(fs.readFileSync(p, "utf-8"));
                console.log(`[Config] Loaded configuration from: ${p}`);
                break;
            } catch {}
        }
    }

    const token = envToken || fileConfig.token;
    const acceptedAuthors = envAuthors || fileConfig.acceptedAuthors || [];
    const streamOpts = fileConfig.streamOpts || {
        width: 1280,
        height: 720,
        fps: 30,
        bitrateKbps: 1000,
        maxBitrateKbps: 2500,
        hardware_acceleration: false,
        videoCodec: "H264"
    };

    if (!token || token === "YOUR_DISCORD_TOKEN_HERE" || token === "SELF TOKEN HERE") {
        console.error(`\n❌ [ERROR] لم يتم العثور على التوكن (Discord Token)!`);
        console.error(`يرجى وضع التوكن في ملف config.json أو كتابته في Environment Variables باسم DISCORD_TOKEN في لوحة التحكم.\n`);
        process.exit(1);
    }

    return { token, acceptedAuthors, streamOpts };
}

const config = loadConfig();
const streamer = new Streamer(new Client());

// ready event
streamer.client.on("ready", () => {
    console.log(`===============================================`);
    console.log(`--- ${streamer.client.user?.tag} (${streamer.client.user?.id}) is ready ---`);
    console.log(`Accepted controller IDs:`, config.acceptedAuthors);
    console.log(`===============================================`);
});

let controller: AbortController | undefined;

async function resolveMediaUrl(rawUrl: string): Promise<string> {
    const isYouTube = rawUrl.includes("youtube.com") || rawUrl.includes("youtu.be");
    const isWebVideo = isYouTube || rawUrl.includes("twitch.tv") || rawUrl.includes("twitter.com") || rawUrl.includes("x.com") || rawUrl.includes("tiktok.com");
    if (!isWebVideo) {
        return rawUrl;
    }

    // 1. YouTube: Native resolution via @distube/ytdl-core (no external tools required)
    if (isYouTube) {
        console.log(`[Info] Resolving YouTube stream via @distube/ytdl-core: ${rawUrl}`);
        try {
            const ytdl = new Ytdl();
            const info = await ytdl.getInfo(rawUrl);

            // Check for live HLS streams
            const liveHls = info.formats.find((f: any) => f.isHLS || f.url?.includes("m3u8") || f.url?.includes("hls_playlist"));
            if (liveHls?.url) {
                console.log(`[Success] Resolved YouTube live HLS stream: ${info.videoDetails.title || rawUrl}`);
                return liveHls.url;
            }

            // Check for combined formats (video + audio)
            const combined = info.formats.find((f: any) => f.hasVideo && f.hasAudio && f.url);
            if (combined?.url) {
                console.log(`[Success] Resolved YouTube stream: ${info.videoDetails.title || rawUrl}`);
                return combined.url;
            }

            // Fallback to highest quality available
            const chosen = chooseFormat(info.formats, { quality: "highest" });
            if (chosen?.url) {
                console.log(`[Success] Resolved YouTube stream format: ${info.videoDetails.title || rawUrl}`);
                return chosen.url;
            }
        } catch (ytdlErr: any) {
            console.warn(`[@distube/ytdl-core Warning]:`, ytdlErr?.message || ytdlErr);
        }
    }

    // 2. yt-dlp fallback (supports YouTube and many other web video platforms)
    console.log(`[Info] Resolving web stream via yt-dlp: ${rawUrl}`);
    const binYtdlp = path.resolve(process.cwd(), "bin/yt-dlp");
    const executable = fs.existsSync(binYtdlp) ? binYtdlp : "yt-dlp";

    try {
        const { stdout } = await execFileAsync(executable, [
            "--no-playlist",
            "-g",
            rawUrl
        ]);
        const lines = stdout.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
            const m3u8 = lines.find(l => l.includes(".m3u8"));
            const chosen = m3u8 || lines[0];
            console.log(`[Info] Successfully resolved stream URL via yt-dlp.`);
            return chosen;
        }
    } catch (err: any) {
        console.error(`[yt-dlp Error]:`, err?.stderr || err?.message);
    }

    // If both failed, check if the rawUrl is direct or notify user
    if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
        console.log(`[Warning] Could not extract stream via ytdl/yt-dlp, attempting direct stream: ${rawUrl}`);
        return rawUrl;
    }

    throw new Error(`تعذر استخراج رابط الفيديو. قد يكون الفيديو محذوفاً أو مقيداً.`);
}

// message event
streamer.client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    if (!msg.content) return;

    if (msg.content.startsWith("$")) {
        if (config.acceptedAuthors.length > 0 && !config.acceptedAuthors.includes(msg.author.id)) {
            console.log(`[Warning] Command "${msg.content.split(' ')[0]}" ignored from unauthorized user: ${msg.author.tag} (${msg.author.id})`);
            return;
        }
    }

    if (msg.content.startsWith("$play-live") || msg.content.startsWith("$play-cam")) {
        const isCam = msg.content.startsWith("$play-cam");
        const mode = isCam ? "camera" : "go-live";
        const args = parseArgs(msg.content);
        if (!args) {
            console.log(`[Error] Missing URL in command.`);
            await msg.reply(`⚠️ يرجى كتابة رابط الفيديو بعد الأمر: \`$${isCam ? 'play-cam' : 'play-live'} <رابط_الفيديو>\``).catch(() => {});
            return;
        }

        const channel = msg.author.voice?.channel;
        if (!channel) {
            console.log(`[Error] User ${msg.author.tag} must be in a voice channel to use this command!`);
            await msg.reply(`⚠️ يجب أن تكون داخل روم صوتي لتشغيل البث!`).catch(() => {});
            return;
        }

        console.log(`[Info] Received $${isCam ? 'play-cam' : 'play-live'} with URL: "${args.url}" from ${msg.author.tag}`);
        await msg.reply(`⏳ جاري الاتصال بالروم ومعالجة البث...`).catch(() => {});

        try {
            console.log(`[Info] Connecting to voice channel: ${(channel as any).name ?? channel.id} (${channel.id}) in guild: ${msg.guildId}`);
            await streamer.joinVoice(msg.guildId!, channel.id);
            console.log(`[Success] Connected to voice channel!`);

            if (channel instanceof StageChannel) {
                await streamer.client.user?.voice?.setSuppressed(false);
            }

            controller?.abort();
            controller = new AbortController();

            // Resolve YouTube / Web stream if applicable
            const streamUrl = await resolveMediaUrl(args.url);

            console.log(`[Info] Preparing media stream...`);
            const { output, promise } = await prepareStream(streamUrl, {
                width: config.streamOpts.width,
                height: config.streamOpts.height,
                frameRate: config.streamOpts.fps,
                bitrateVideo: config.streamOpts.bitrateKbps,
                bitrateVideoMax: config.streamOpts.maxBitrateKbps,
                videoCodec: Utils.normalizeVideoCodec(config.streamOpts.videoCodec)
            }, controller.signal);

            promise.catch((err) => {
                if (err?.name === "AbortError" || controller?.signal.aborted) return;
                console.error("[Stream Pipeline Error]:", err);
            });

            console.log(`[Info] Starting playback mode: ${mode}...`);
            await msg.reply(`✅ بدأ البث المباشر بنجاح!`).catch(() => {});
            await playStream(output, streamer, { type: mode as any }, controller.signal);
            console.log("[Success] Finished playing video.");
        } catch (err: any) {
            if (err?.name === "AbortError" || controller?.signal.aborted) {
                console.log("[Info] Stream stopped gracefully by user.");
                return;
            }
            console.error("[Execution Error]:", err);
            await msg.reply(`❌ فشل تشغيل الفيديو: ${err?.message || 'خطأ غير معروف'}`).catch(() => {});
            controller?.abort();
        }
    } else if (msg.content.startsWith("$disconnect")) {
        console.log(`[Info] Disconnecting from voice...`);
        controller?.abort();
        streamer.leaveVoice();
        await msg.reply(`👋 تم الخروج من الروم الصوتي.`).catch(() => {});
        console.log(`[Success] Disconnected.`);
    } else if (msg.content.startsWith("$stop-stream")) {
        console.log(`[Info] Stopping current stream...`);
        controller?.abort();
        await msg.reply(`⏹️ تم إيقاف البث.`).catch(() => {});
        console.log(`[Success] Stream stopped.`);
    }
});

// login
streamer.client.login(config.token);

function parseArgs(message: string): Args | undefined {
    const args = message.trim().split(/\s+/);
    if (args.length < 2) return;
    const url = args[1];
    return { url };
}

type Args = {
    url: string;
};
