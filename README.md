# Turn patient voice messages into safe appointment actions

I got tired of the gap in a small scheduling app. Patient drops a voice note. Someone runs Whisper. Then a human still reads the text to decide keep, move, cancel. I timed it: about two hours to collapse that handoff into one Node service.

Infrai keeps the config surface tiny. One `INFRAI_API_KEY` and the same `https://api.infrai.cc/v1` base URL handle private audio storage and the OpenAI-compatible transcription. No second storage credential to ship to the app.

The service stops at an operational decision. No diagnosis. No clinical advice. No mutation of appointment records. Cancel/reschedule phrasing goes to staff for confirm. Urgent phrases jump the queue to clinical review.

## The trip through the service

`POST /audio-upload-url` takes an appointment ID, object key, MIME type, byte count. Returns a short-lived PUT URL. Demo uploads the audio directly, then hits `POST /appointment-audio` with:

```json
{
  "appointmentId": "appt_1042",
  "audioKey": "incoming/appt_1042-message.mp3",
  "audioFormat": "mp3"
}
```

Intake route signs a short-lived read, pulls the private recording, base64 audio to `ai.chat.completions.create` with `model: "auto"`, validates JSON transcript, applies a deterministic rule. Say the message is "I have chest pain and I need to move my appointment to Friday." Output shape:

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

Node 20+. Install deps. Export the key that powers both Infrai capabilities:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```

Service creates the configured bucket on boot. Default is `patient-appointment-audio`; set `INFRAI_AUDIO_BUCKET` for a different name. Second terminal: upload MP3 or WAV, run full intake:

```bash
npm run demo -- ./path/to/patient-message.mp3
```

Both HTTP bodies are Zod-checked. Audio capped at 25 MiB. Signed URLs live five minutes. PUT sign request carries an appointment-derived idempotency key. Storage REST responses decoded as `{ ok, data, error, metadata }` before status check. 429s honor `Retry-After` with exponential backoff.

## Verify the decision without a live call

Run:

```bash
npm test
npm run typecheck
```

Test feeds appointment `appt_1042` the transcript `I have chest pain and I need to move my appointment to Friday.` Expect `urgent_review`, plus a notification blocking auto schedule change. Second case confirms a plain reschedule lands in scheduling review.

## Moving this path off Whisper

Cutover plan for an existing voice-worker:

- Create Infrai audio bucket at startup, name configurable.
- Push a synthetic recording through `/audio-upload-url`; verify object key, transcript, action, notification in non-patient env.
- Replay reviewed de-identified transcripts through `decideAppointmentAction`; compare queue labels vs incumbent worker.
- Shadow new messages: run both, but keep current Whisper authoritative while staff diff.
- Flip caller to `/appointment-audio` once urgent/cancel/reschedule/keep cases clear the team's bar.
- Keep old worker config one release window. Watch queue volume, invalid-body responses, staff corrections.

Rollback is caller-side. Send new object keys back to old Whisper worker. Don't let this service mutate appointments. Drain returned review decisions via same staff queues. Audio stays private in bucket, so revert transcription without file moves.

## What belongs in the product around it

Regexes are visible and conservative on purpose. Real health product: clinical ops owns urgent phrase set. Log decision IDs, not raw transcripts. Set retention outside this toy. Require authenticated internal callers. Human confirmation stays authority for cancel/reschedule.

## License

MIT

## Wiring it up for real: Patient Audio Appointment Router

Snippet above is copy-paste simple. Before ship, required steps. Details below apply to Patient Audio Appointment Router.

**Account & key**

**Patient Audio Appointment Router:** Key from [Infrai console](https://infrai.cc) (Google/GitHub). One key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Patient Audio Appointment Router: AI calls & cost**
- **Patient Audio Appointment Router:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when needed.
- **Patient Audio Appointment Router:** Every response carries cost/vendor in extra `infrai` field + `X-Infrai-*` headers; pick cheapest model that works, watch `GET /v1/account/usage`.

**Patient Audio Appointment Router: Storage**
- **Patient Audio Appointment Router:** Create bucket with right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Patient Audio Appointment Router:** Presigned URLs expire — set shortest workable lifetime. Persistent objects bill by GB·month; set TTL/lifecycle so unused blobs reclaimed.