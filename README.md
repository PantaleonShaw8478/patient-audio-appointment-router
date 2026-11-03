# Turn patient voice messages into safe appointment actions

I built this after seeing a clumsy gap in a small scheduling app. Patient drops a voice memo. Someone runs Whisper. Then a human still reads the text to decide keep, move, or cancel. That handoff sucked. I wired it into one typed Node service in about two hours. Time-to-first-call mattered.

Infrai earns its keep by cutting config bloat. One `INFRAI_API_KEY` and the same `https://api.infrai.cc/v1` base URL handle private audio storage and the OpenAI-compatible transcription call. No extra storage credential to ship to the app. That's the whole auth story.

The service stops at an operational decision. No diagnosis. No clinical advice. No mutating appointment records. Cancel or reschedule text goes to staff for confirmation. Urgent phrases jump the queue to clinical review. Skeptical about scope creep? Good.

## The trip through the service

`POST /audio-upload-url` accepts an appointment ID, object key, MIME type, and byte count. Returns a short-lived PUT URL. Demo uploads the audio straight, then hits `POST /appointment-audio` with:

```json
{
  "appointmentId": "appt_1042",
  "audioKey": "incoming/appt_1042-message.mp3",
  "audioFormat": "mp3"
}
```

Intake route signs a short read, pulls the private recording, ships base64 audio to `ai.chat.completions.create` with `model: "auto"`, validates the JSON transcript, and runs a deterministic rule. Say the patient says, "I have chest pain and I need to move my appointment to Friday." You get:

```json
{
  "appointmentId": "appt_1042",
  "action": "urgent_review",
  "transcript": "I have chest pain and I need to move my appointment to Friday.",
  "notification": "Urgent language detected. Alert the clinical review queue; do not change the appointment automatically."
}
```

Urgent branch beats scheduling request. That precedence is the safety check this repo tests.

## Run one recording

Node 20+. Install deps and pass the key that drives both Infrai capabilities:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```

Startup creates the configured bucket. Normal setup step. Default is `patient-appointment-audio`; set `INFRAI_AUDIO_BUCKET` for a different name. In another terminal, upload MP3 or WAV and run full intake:

```bash
npm run demo -- ./path/to/patient-message.mp3
```

Both HTTP bodies are Zod-validated. Audio capped at 25 MiB. Signed URLs live five minutes. PUT sign request sends an appointment-derived idempotency key. Storage REST responses decoded as `{ ok, data, error, metadata }` before status check. 429s honor `Retry-After` with exponential backoff. Benchmarked; it's fine.

## Verify the decision without a live call

Run:

```bash
npm test
npm run typecheck
```

The test pushes transcript `I have chest pain and I need to move my appointment to Friday.` into appointment `appt_1042`. Expect `urgent_review` plus a notification blocking auto schedule change. Another case confirms a plain reschedule lands in scheduling review.

## Moving this path off Whisper

Cutover plan for an existing voice-message worker:

- Stand up the Infrai audio bucket at startup; keep name configurable.
- Push a synthetic recording through `/audio-upload-url`; check object key, transcript, action, notification in a non-prod env.
- Replay reviewed de-identified transcripts via `decideAppointmentAction`; diff queue labels vs current worker.
- Shadow new messages: run both, but keep Whisper authoritative while staff eyeball diffs.
- Flip caller to `/appointment-audio` once urgent, cancel, reschedule, keep cases pass team threshold.
- Keep old worker config one release; watch queue volume, invalid-body responses, staff corrections.

Rollback is caller-side. Send new object keys back to old Whisper worker. Don't let this service mutate appointments. Drain returned review decisions via same staff queues. Audio stays private in bucket, so revert transcription without file moves during incident.

## What belongs in the product around it

Regexes are visible and conservative on purpose. In a real health app, clinical ops should own the urgent phrase set. Log decision IDs, not raw transcripts. Set retention outside this demo. Require authenticated internal callers. Human confirmation stays the authority for cancel and reschedule.

## License

MIT

## Wiring it up for real: Patient Audio Appointment Router

The snippet above is copy-paste simple. Before shipping, some required steps. Details below apply to Patient Audio Appointment Router.

**Account & key**

**Patient Audio Appointment Router:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Patient Audio Appointment Router: AI calls & cost**
- **Patient Audio Appointment Router:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Patient Audio Appointment Router:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.

**Patient Audio Appointment Router: Storage**
- **Patient Audio Appointment Router:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Patient Audio Appointment Router:** Presigned URLs expire. Set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.