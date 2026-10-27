import { Client, StageChannel } from "@lng2004/discord.js-selfbot-v13";
import { Streamer, Utils, prepareStream, playStream } from "@dank074/discord-video-stream";
import config from "./config.json" with {type: "json"};
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
    const isWebVideo = rawUrl.includes("youtube.com") || rawUrl.includes("youtu.be") || rawUrl.includes("twitch.tv") || rawUrl.includes("twitter.com") || rawUrl.includes("x.com");
    if (!isWebVideo) {
        return rawUrl;
    }

    console.log(`[Info] Resolving web stream via yt-dlp: ${rawUrl}`);
    try {
        const { stdout } = await execFileAsync("yt-dlp", [
            "--no-playlist",
            "-g",
            rawUrl
        ]);
        const lines = stdout.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
            // Prefer m3u8 playlist if available (e.g. YouTube Live / Twitch)
            const m3u8 = lines.find(l => l.includes(".m3u8"));
            const chosen = m3u8 || lines[0];
            console.log(`[Info] Successfully resolved stream URL via yt-dlp.`);
            return chosen;
        }
    } catch (err: any) {
        console.error(`[yt-dlp Error]:`, err?.stderr || err?.message);
        throw new Error(`تعذر استخراج رابط الفيديو من يوتيوب. قد يكون الفيديو محذوفاً أو مقيداً.`);
    }
    return rawUrl;
}

// message event
streamer.client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    if (!msg.content) return;

    if (msg.content.startsWith("$")) {
        if (!config.acceptedAuthors.includes(msg.author.id)) {
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
