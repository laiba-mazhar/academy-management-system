-- Tracks when a student's exam result was sent to their guardian over WhatsApp
-- (via the send-result-whatsapp edge function). Lets the Marks Entry screen
-- show a "sent" status and avoid accidentally messaging the same parent twice.
alter table exam_results add column if not exists whatsapp_sent_at timestamptz;
