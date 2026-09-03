-- Safe canonical question import contract for JAMB CBT.
-- This migration is intentionally non-destructive.
-- It documents the canonical table and field names and prevents legacy import scripts
-- from being treated as the live application contract.

-- Canonical table: public."Questions"
-- Canonical columns:
--   id, "Subject", "Question", "Option_a", "Option_b", "Option_c", "Option_d",
--   "Correct_Answer", "test_type", "Topic", "Explanation", "exam", "year",
--   "source", "is_active", "updated_at", "import_key"

-- Compatibility view for legacy lowercase access.
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

COMMENT ON VIEW public.questions IS 'Compatibility view for legacy lowercase question access. The live canonical table remains public."Questions".';

GRANT SELECT ON public.questions TO authenticated;
GRANT SELECT ON public.questions TO anon;

-- Legacy import patterns such as INSERT INTO questions (...), OptionA/OptionB/OptionC/OptionD,
-- and Answer are not canonical and must be normalized before import.
-- This migration does not delete or rewrite live data.
