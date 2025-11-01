require("dotenv").config();
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const fs = require("fs");
const express = require("express");
const { exec } = require("child_process");
const util = require("util");

const app = express();
app.use(express.json());
const execPromise = util.promisify(exec);

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

// Helper → get audio duration
async function getDuration(file) {
  const { stdout } = await execPromise(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`
  );
  return parseFloat(stdout.trim());
}

app.post("/render-video", async (req, res) => {
  try {
    const { scenes, music } = req.body;
    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      return res.status(400).json({ error: "Scenes array (image,audio,text) required" });
    }

    // ✅ Validate scenes
    for (let i = 0; i < scenes.length; i++) {
      const { image, audio, text } = scenes[i];
      if (!fs.existsSync(image)) return res.status(400).json({ error: `Missing image: ${image}` });
      if (!fs.existsSync(audio)) return res.status(400).json({ error: `Missing audio: ${audio}` });
      if (!text) return res.status(400).json({ error: `Missing subtitle text in scene ${i}` });
    }

    //------------------------------------------------
    // 🎧 PASS 1 → Continuous Audio + BGM loop
    //------------------------------------------------
    let prevAudio = scenes[0].audio;
    for (let i = 1; i < scenes.length; i++) {
      const nextAudio = scenes[i].audio;
      const mergedAudio = `merged_audio_${i}.mp3`;

      // simple concat for narration continuity
      await execPromise(
        `ffmpeg -y -i "${prevAudio}" -i "${nextAudio}" -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[a]" -map "[a]" "${mergedAudio}"`
      );
      if (prevAudio !== scenes[0].audio) fs.unlinkSync(prevAudio);
      prevAudio = mergedAudio;
    }
    const narrationAudio = prevAudio;

    const bgTrack = music && fs.existsSync(music) ? music : "bgmusic.mp3";
    const finalAudio = "final_audio.mp3";
    await execPromise(
      `ffmpeg -y -i "${narrationAudio}" -stream_loop -1 -i "${bgTrack}" -filter_complex "[0:a][1:a]amix=inputs=2:duration=first[a]" -map "[a]" "${finalAudio}"`
    );

    //------------------------------------------------
    // 🎞 PASS 2 → Silent Video Build with Crossfades
    //------------------------------------------------
    const videoParts = [];
    let totalTime = 0;
    const timestamps = [];

    for (let i = 0; i < scenes.length; i++) {
      const { image, audio, text } = scenes[i];
      const duration = await getDuration(audio);
      const sceneVideo = `scene_${i}.mp4`;

      await execPromise(
        `ffmpeg -loop 1 -y -i "${image}" -t ${duration} -vf "scale=1280:720" -c:v libx264 -pix_fmt yuv420p "${sceneVideo}"`
      );
      timestamps.push({ start: totalTime, end: totalTime + duration, text });
      totalTime += duration;
      videoParts.push(sceneVideo);
    }

    // merge all silent videos with fades
    let prevVideo = videoParts[0];
    for (let i = 1; i < videoParts.length; i++) {
      const dur = await getDuration(scenes[i - 1].audio);
      const fadeDur = Math.min(1, dur / 3);
      const mergedVideo = `merged_video_${i}.mp4`;

      await execPromise(
        `ffmpeg -y -i "${prevVideo}" -i "${videoParts[i]}" -filter_complex "[0:v][1:v]xfade=transition=fade:duration=${fadeDur}:offset=${dur - fadeDur}[v]" -map "[v]" -an "${mergedVideo}"`
      );
      if (prevVideo !== videoParts[0]) fs.unlinkSync(prevVideo);
      prevVideo = mergedVideo;
    }
    const finalVideo = prevVideo;

    //------------------------------------------------
    // 📝 PASS 3 → Subtitles + Final Mux
    //------------------------------------------------
    // create subs.srt dynamically
    const toTime = (t) => {
      const h = String(Math.floor(t / 3600)).padStart(2, "0");
      const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
      const s = String(Math.floor(t % 60)).padStart(2, "0");
      const ms = String(Math.floor((t % 1) * 1000)).padStart(3, "0");
      return `${h}:${m}:${s},${ms}`;
    };
    let srt = "";
    timestamps.forEach((t, i) => {
      srt += `${i + 1}\n${toTime(t.start)} --> ${toTime(t.end)}\n${t.text}\n\n`;
    });
    fs.writeFileSync("subs.srt", srt);

    const finalOutput = "output_final.mp4";
    await execPromise(
      `ffmpeg -y -i "${finalVideo}" -i "${finalAudio}" -vf subtitles=subs.srt -shortest -map 0:v:0 -map 1:a:0 -c:v libx264 -c:a aac -b:a 192k "${finalOutput}"`
    );

    //------------------------------------------------
    // ☁ Upload to S3
    //------------------------------------------------
    const fileStream = fs.createReadStream(finalOutput);
    const uploadParams = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: `rendered-${Date.now()}.mp4`,
      Body: fileStream,
    };
    await s3.send(new PutObjectCommand(uploadParams));

    const url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${uploadParams.Key}`;
    const cmd = new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: uploadParams.Key });
    const signedUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 * 30 });

    res.json({
      message: "🎬 Tri‑pass render success (fixed‑audio mux)",
      scenes: scenes.length,
      s3_url: url,
      signed_url: signedUrl
    });

  } catch (err) {
    console.error("❌ Workflow error:", err);
    res.status(500).json({ error: "Render failed", details: err.message });
  }
});

app.listen(3000, () => {
  console.log("🚀 API running: final tri‑pass with subtitles + audio fix");
});
