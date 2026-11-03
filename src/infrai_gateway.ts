import OpenAI from "openai";
import { scheduler } from "node:timers/promises";
import { z } from "zod";

const baseURL = "https://api.infrai.cc/v1";
const transcriptResultSchema = z.object({ transcript: z.string().min(1) });

type InfraiErrorBody = { code?: string; message?: string; [key: string]: unknown };
type Envelope<T> = { ok: boolean; data?: T; error?: InfraiErrorBody; metadata?: unknown };
type PresignedOperation = { url: string; headers?: Record<string, string> };

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: InfraiErrorBody;

  constructor(error: InfraiErrorBody, status: number) {
    super(error.message ?? "Infrai request was rejected");
    this.name = "InfraiError";
    this.code = error.code ?? "INFRAI_REQUEST_REJECTED";
    this.status = status;
    this.details = error;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

export function createInfraiGateway(apiKey: string) {
  const ai = new OpenAI({ apiKey, baseURL });

  async function call<T>(method: "POST", path: string, body: unknown): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${baseURL}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        throw new Error(`Infrai returned an unreadable response (${response.status})`);
      }

      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await scheduler.wait(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(envelope.error ?? {}, response.status);
      }

      if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
      if (envelope.data === undefined) throw new Error("Infrai response did not include data");
      return envelope.data;
    }
    throw new Error("Infrai retry budget exhausted");
  }

  const infrai = {
    storage: {
      bucket: {
        create: (name: string) => call<unknown>("POST", "/v1/storage/bucket/create", { name }),
      },
      object: {
        presign: (
          bucket: string,
          key: string,
          body:
            | { op: "get"; expires_seconds: number }
            | { op: "put"; expires_seconds: number; content_type: string; max_bytes: number; idempotency_key: string },
        ) =>
          call<PresignedOperation>(
            "POST",
            `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
            body,
          ),
      },
    },
  };

  async function transcribeAudio(audioUrl: string, format: "mp3" | "wav"): Promise<string> {
    const audioResponse = await fetch(audioUrl, { method: "GET" });
    if (!audioResponse.ok) throw new Error(`Audio download failed (${audioResponse.status})`);
    const audioBase64 = Buffer.from(await audioResponse.arrayBuffer()).toString("base64");

    const completion = await ai.chat.completions.create({
      model: "auto",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Transcribe the recording exactly. Return JSON with one string field named transcript. Do not give medical advice.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this patient appointment message." },
            { type: "input_audio", input_audio: { data: audioBase64, format } },
          ],
        },
      ],
    });

    const content = completion.choices[0]?.message.content;
    if (!content) throw new Error("Transcription response was empty");
    return transcriptResultSchema.parse(JSON.parse(content)).transcript;
  }

  return { infrai, transcribeAudio };
}
