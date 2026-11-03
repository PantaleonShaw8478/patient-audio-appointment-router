import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

const audioPath = process.argv[2];
if (!audioPath) throw new Error("Run: npm run demo -- ./path/to/message.mp3");
const format = audioPath.toLowerCase().endsWith(".wav") ? "wav" : "mp3";
const contentType = format === "wav" ? "audio/wav" : "audio/mpeg";
const appointmentId = "appt_1042";
const audioKey = `incoming/${appointmentId}-${basename(audioPath)}`;
const file = await readFile(audioPath);
const fileStat = await stat(audioPath);

const signingResponse = await fetch("http://localhost:3000/audio-upload-url", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    appointmentId,
    audioKey,
    contentType,
    bytes: fileStat.size,
  }),
});
if (!signingResponse.ok) throw new Error(`Upload signing failed (${signingResponse.status})`);
const upload = (await signingResponse.json()) as { url: string; headers?: Record<string, string> };

const uploadResponse = await fetch(upload.url, {
  method: "PUT",
  headers: { "content-type": contentType, ...upload.headers },
  body: file,
});
if (!uploadResponse.ok) throw new Error(`Audio upload failed (${uploadResponse.status})`);

const response = await fetch("http://localhost:3000/appointment-audio", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ appointmentId, audioKey, audioFormat: format }),
});
if (!response.ok) throw new Error(`Intake failed (${response.status})`);

console.log(JSON.stringify(await response.json(), null, 2));
