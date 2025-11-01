# 🎬 FFmpeg Microservice (Railway Deploy)

This is a Node.js + Express microservice that runs FFmpeg commands.

## Usage
Deploy on Railway.app:
- POST /render
  Example payload:
  ```json
  {
    "scenes": [
      { "text": "Hello World" }
    ]
  }
