-- Raw evidence moves to R2 (ADR-0015). Some FDA records exceed D1's 2 MB value
-- and 100 KB statement limits (the largest is ~8.8 MB of serial numbers), so
-- the verbatim record is kept in an R2 NDJSON bundle and `raw_ref` records
-- exactly where: "<r2 key>#<byte offset>:<byte length>". `raw_sha256` still
-- fingerprints the record, so the bytes can be verified after a range read.

ALTER TABLE recall DROP COLUMN raw;
ALTER TABLE recall ADD COLUMN raw_ref TEXT NOT NULL DEFAULT '';
