require("dotenv").config();
const AWS = require("aws-sdk");
const fs = require("fs");

// Initialize S3 client
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

async function uploadVideo() {
  try {
    // 🟢 FFmpeg ke output file ka path
    const videoPath = "output.mp4";

    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: "rendered-video.mp4",  // S3 me file ka naam
      Body: fs.createReadStream(videoPath)
    };

    const data = await s3.upload(params).promise();
    console.log("✅ Video uploaded successfully!");
    console.log("📍 S3 Video URL:", data.Location);
  } catch (err) {
    console.error("❌ Upload Failed:", err);
  }
}

uploadVideo();
