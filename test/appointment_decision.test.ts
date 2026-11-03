import assert from "node:assert/strict";
import test from "node:test";
import { decideAppointmentAction } from "../src/appointment_decision.ts";

test("urgent language is escalated without changing the appointment", () => {
  const result = decideAppointmentAction(
    "appt_1042",
    "I have chest pain and I need to move my appointment to Friday.",
  );

  assert.equal(result.action, "urgent_review");
  assert.match(result.notification, /do not change the appointment automatically/i);
  assert.equal(result.appointmentId, "appt_1042");
});

test("a routine reschedule request goes to scheduling review", () => {
  const result = decideAppointmentAction("appt_2048", "Can I reschedule my visit to a different day?");

  assert.equal(result.action, "reschedule_review");
  assert.match(result.notification, /scheduling staff/i);
});
