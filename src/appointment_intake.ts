import { createServer } from "node:http";
import { z } from "zod";
import { decideAppointmentAction } from "./appointment_decision.ts";
import { createInfraiGateway, InfraiError } from "./infrai_gateway.ts";

const requestSchema = z.object({
  appointmentId: z.string().min(1).max(100),
  audioKey: z.string().min(1).max(500).refine((key) => !key.includes(".."), "audioKey cannot contain .."),
  audioFormat: z.enum(["mp3", "wav"]),
});

const uploadSchema = z.object({
  appointmentId: z.string().min(1).max(100),
  audioKey: z.string().min(1).max(500).refine((key) => !key.includes(".."), "audioKey cannot contain .."),
  contentType: z.enum(["audio/mpeg", "audio/wav"]),
  bytes: z.number().int().positive().max(25 * 1024 * 1024),
});

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const bucket = process.env.INFRAI_AUDIO_BUCKET ?? "patient-appointment-audio";
const port = Number(process.env.PORT ?? 3000);
const { infrai, transcribeAudio } = createInfraiGateway(apiKey);

function sendJson(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

await infrai.storage.bucket.create(bucket);

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/audio-upload-url") {
    try {
      const input = uploadSchema.parse(await readJson(request));
      const upload = await infrai.storage.object.presign(bucket, input.audioKey, {
        op: "put",
        expires_seconds: 300,
        content_type: input.contentType,
        max_bytes: input.bytes,
        idempotency_key: `appointment-audio-${input.appointmentId}`,
      });
      sendJson(response, 200, upload);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendJson(response, 400, { error: "Invalid request", issues: error.issues });
        return;
      }
      if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
        sendJson(response, error.status, { error: error.code, message: error.message });
        return;
      }
      console.error(error);
      sendJson(response, 500, { error: "Unable to prepare audio upload" });
    }
    return;
  }

  if (request.method !== "POST" || request.url !== "/appointment-audio") {
    sendJson(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const input = requestSchema.parse(await readJson(request));
    const signedAudio = await infrai.storage.object.presign(bucket, input.audioKey, {
      op: "get",
      expires_seconds: 300,
    });
    const transcript = await transcribeAudio(signedAudio.url, input.audioFormat);
    sendJson(response, 200, decideAppointmentAction(input.appointmentId, transcript));
  } catch (error) {
    if (error instanceof z.ZodError) {
      sendJson(response, 400, { error: "Invalid request", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      sendJson(response, error.status, { error: error.code, message: error.message });
      return;
    }
    console.error(error);
    sendJson(response, 500, { error: "Unable to process appointment audio" });
  }
});

server.listen(port, () => {
  console.log(`Appointment audio intake listening on http://localhost:${port}`);
});
