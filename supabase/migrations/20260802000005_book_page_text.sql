-- Text layer of an uploaded book page, kept alongside the picture of it.
--
-- Most "scanned" books are really digital PDFs — the text is in the file, it
-- just is not selectable in a viewer that renders them as pictures. Where that
-- text exists, snipping a region can hand back the real characters instead of
-- an image: exact Urdu, exact English, exact mathematical notation, with no
-- recognition step to corrupt any of it.
--
-- Items are stored with their position as fractions of the page, so the region
-- a teacher drags can be matched against them whatever size the page is
-- displayed at. Null means the page genuinely has no text layer — a true scan
-- — and snips from it stay pictures.
alter table source_book_pages add column if not exists text_items jsonb;

comment on column source_book_pages.text_items is
  'Positioned text from the page as [{"t","x","y","w","h"}], fractions of the page. Null for a true scan with no text layer.';
