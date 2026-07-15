-- Lets an invoice carry a settable due date (distinct from the month it
-- covers), so fee challans can show "due by" instead of just the month.
alter table invoices add column if not exists due_date date;
