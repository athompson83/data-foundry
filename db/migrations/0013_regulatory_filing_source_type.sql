-- 0013_regulatory_filing_source_type.sql
--
-- Widen `sources_source_type_allowed` for `REGULATORY_FILING`.
--
-- The vocabulary had `REGULATORY` and `CERTIFICATION_BODY` and nothing between
-- them, so a regulator-hosted register of MANUFACTURER FILINGS — which is what
-- every lawful HVAC source turns out to be — had no honest label. Calling it
-- `REGULATORY` claims the agency asserts the value; calling it
-- `CERTIFICATION_BODY` claims somebody independent measured it. Both are
-- overstatements, and the second is the one the fact-selection config was
-- silently relying on.
--
-- The distinction is the publisher's own. DOE, verbatim, on its Compliance
-- Certification Database: "The appearance of a model on this web site is not an
-- indication that DOE has determined that the model is compliant with DOE
-- energy conservation standards."
--
-- Widening a CHECK is exactly the case 0001's own portability note anticipated:
-- "a CHECK constraint is trivially widened by a later migration, an enum type is
-- not." No row is rewritten; nothing that was valid becomes invalid.

ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_source_type_allowed;

ALTER TABLE sources ADD CONSTRAINT sources_source_type_allowed CHECK (source_type IN (
    'REGULATORY', 'STANDARDS_BODY', 'CERTIFICATION_BODY', 'REGULATORY_FILING',
    'MANUFACTURER', 'DISTRIBUTOR', 'TRADE_ASSOCIATION', 'MARKETPLACE',
    'AGGREGATOR', 'COMMUNITY', 'PARTNER_FEED', 'LICENSED_DATASET',
    'OPEN_DATASET', 'OTHER'
));

COMMENT ON COLUMN sources.source_type IS
    'What KIND of publisher this is. REGULATORY_FILING is a regulator-hosted register of values the manufacturer asserted; it is not a certification.';
