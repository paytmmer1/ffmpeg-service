import express from "express";
import { exec } from "child_process";
import fs from "fs";
import fetch from "node-fetch";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const app = express();
app.use(express.json());

// 🟢 AWS S3 Config
const s3 = new S3Client({
  region: "ap-southeast-1", // Singapore region, अपने bucket region से match करो
  credentials: {
    accessKeyId: "YOUR_ACCESS_KEY_ID",     // ← यहां IAM Access Key ID डालो
    secretAccessKey: "YOUR_SECRET_ACCESS_KEY"  // ← यहां Secret Key डालो
  }
});
const BUCKET_NAME = "ffmpeg-videos-bucket-2025";

// Root test route
app.get("/", (req, res) => {
  res.send("✅ FFmpeg microservice with S3 upload active! Use POST /render");
});

// Render route
app.post("/render", async (req, res) => {
  try {
    // 1. Dummy image fetch
    const response = await fetch("https://picsum.photos/640/360");
    const buffer = await response.arrayBuffer();
    fs.writeFileSync("input.png", Buffer.from(buffer));

    // 2. Run FFmpeg (3 sec test video)
    const cmd = `ffmpeg -y -loop 1 -t 3 -i input.png \
      -vf "scale=640:360,setsar=1" \
      -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p output.mp4`;

    exec(cmd, async (err) => {
      if (err) {
        console.error("❌ FFmpeg error:", err);
        return res.status(500).json({ error: err.message });
      }

      // 3. Upload video to S3
      const fileContent = fs.readFileSync("output.mp4");
      const fileName = `video_${Date.now()}.mp4`;

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileName,
        Body: fileContent,
        ContentType: "video/mp4",
        ACL: "public-read"   // public sharable link
      }));

      // 4. Build public URL
      const fileUrl = `https://${BUCKET_NAME}.s3.ap-southeast-1.amazonaws.com/${fileName}`;

      res.json({
        success: true,
        message: "✅ Video rendered & uploaded to S3!",
        url: fileUrl
      });
    });

  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Start Server
app.listen(3000, () => {
  console.log("🚀 Server with S3 upload running on port 3000");
});
