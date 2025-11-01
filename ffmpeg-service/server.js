app.post("/render", async (req, res) => {
  try {
    // Download random placeholder image for input
    const response = await fetch("https://picsum.photos/640/360"); // smaller resolution
    const buffer = await response.arrayBuffer();
    fs.writeFileSync("input.png", Buffer.from(buffer));

    // ⚡ ultra-light command → 2 sec video only
    const cmd = `ffmpeg -y -loop 1 -t 2 -i input.png \
      -vf "scale=640:360:force_original_aspect_ratio=decrease" \
      -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p output.mp4`;

    exec(cmd, (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
      }

      res.json({
        success: true,
        message: "✅ 2 second test video rendered successfully",
        file: "output.mp4 (inside container)"
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
