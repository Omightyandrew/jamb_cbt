-- Safe compatibility migration for the canonical JAMB CBT question table.
-- This file is intentionally non-destructive. It does not rename, drop, or modify the existing live table.
-- Canonical table: public."Questions"
-- Compatibility view: public.questions
-- Canonical field contract:
--   id, "Subject", "Question", "Option_a", "Option_b", "Option_c", "Option_d",
--   "Correct_Answer", "test_type", "Topic", "Explanation", "exam", "year",
--   "source", "is_active", "updated_at", "import_key"

CREATE OR REPLACE VIEW public.questions AS
SELECT
  id,
  "Subject",
  "Question",
  "Option_a",
  "Option_b",
  "Option_c",
  "Option_d",
  "Correct_Answer",
  "test_type",
  "Topic",
  "Explanation",
  "exam",
  "year",
  "source",
  "is_active",
  "updated_at",
  "import_key"
FROM public."Questions";

COMMENT ON VIEW public.questions IS 'Compatibility view for lowercase legacy question references. Canonical table remains public."Questions". Legacy import scripts that use OptionA/OptionB/Answer are intentionally not treated as canonical.';

GRANT SELECT ON public.questions TO authenticated;
GRANT SELECT ON public.questions TO anon;

-- Safety note:
-- This compatibility layer is intentionally read-only. It is used to normalize older
-- lowercase legacy references without changing the live table or its data.
