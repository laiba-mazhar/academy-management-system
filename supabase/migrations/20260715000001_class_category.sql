-- Adds a "category"/stream field to classes so admin can filter students
-- across grades by stream (e.g. Biology, Computer Science, Pre-Medical,
-- Pre-Engineering) rather than only by class name.

alter table classes add column if not exists category text;
