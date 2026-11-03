export type AppointmentAction = "keep" | "reschedule_review" | "cancel_review" | "urgent_review";

export type AppointmentDecision = {
  appointmentId: string;
  action: AppointmentAction;
  transcript: string;
  notification: string;
};

const urgentTerms = /\b(chest pain|cannot breathe|can't breathe|severe bleeding|unconscious|suicidal)\b/i;
const cancelTerms = /\b(cancel|call off|do not need)\b/i;
const rescheduleTerms = /\b(reschedule|move (?:my|the) appointment|different (?:day|time)|change (?:my|the) appointment)\b/i;

export function decideAppointmentAction(appointmentId: string, transcript: string): AppointmentDecision {
  if (urgentTerms.test(transcript)) {
    return {
      appointmentId,
      action: "urgent_review",
      transcript,
      notification: "Urgent language detected. Alert the clinical review queue; do not change the appointment automatically.",
    };
  }

  if (cancelTerms.test(transcript)) {
    return {
      appointmentId,
      action: "cancel_review",
      transcript,
      notification: "Cancellation requested. Ask scheduling staff to confirm with the patient before changing the appointment.",
    };
  }

  if (rescheduleTerms.test(transcript)) {
    return {
      appointmentId,
      action: "reschedule_review",
      transcript,
      notification: "Reschedule requested. Send this transcript to scheduling staff for confirmation.",
    };
  }

  return {
    appointmentId,
    action: "keep",
    transcript,
    notification: "No schedule change requested. Keep the appointment as booked.",
  };
}
