-- Tracks when a student's exam result was sent to their guardian over
-- WhatsApp (via the send-result-whatsapp edge function), so the UI can show
-- a sent/not-sent status per result instead of re-sending blindly.
alter table exam_results add column if not exists whatsapp_sent_at timestamptz;
