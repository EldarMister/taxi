export type RegistrationAnalyticsEvent =
  | 'registration_started'
  | 'role_selected'
  | 'registration_step_opened'
  | 'registration_step_completed'
  | 'document_upload_started'
  | 'document_upload_success'
  | 'document_upload_failed'
  | 'registration_submitted'
  | 'registration_correction_opened'
  | 'registration_resubmitted'
  | 'registration_approved'
  | 'registration_rejected'
  | 'support_opened';

type SafePayload = { step?: string; role?: string; documentType?: string; outcome?: string };
type Sink = (event: RegistrationAnalyticsEvent, payload: SafePayload) => void;
let sink: Sink | null = null;

// The app currently has no analytics provider. Keeping one narrow, PII-free sink
// makes the funnel observable as soon as a provider is connected, without ever
// sending names, phone numbers, document values or local file paths.
export function configureRegistrationAnalytics(next: Sink | null) { sink = next; }
export function trackRegistration(event: RegistrationAnalyticsEvent, payload: SafePayload = {}) { sink?.(event, payload); }
