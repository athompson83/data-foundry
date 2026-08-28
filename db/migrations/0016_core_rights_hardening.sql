-- 0016_core_rights_hardening.sql
--
-- Forward-only hardening for rights/storage/export review findings. This file
-- deliberately creates no grants and performs no guessed legacy backfill.

-- Once a rights cell names a field group, its membership is part of that
-- cell's immutable meaning. Serialize cell creation and member insertion on
-- the group row so a concurrent insert cannot race the first reference.
CREATE OR REPLACE FUNCTION rights_validate_cell_field_group()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    group_source UUID;
BEGIN
    IF NEW.field_group_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT source_id INTO group_source
      FROM rights_field_groups
     WHERE id = NEW.field_group_id
       FOR SHARE;
    IF group_source IS NULL OR group_source IS DISTINCT FROM NEW.source_id THEN
        RAISE EXCEPTION 'rights field group must belong to the cell source'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION rights_reject_referenced_field_group_expansion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM id
      FROM rights_field_groups
     WHERE id = NEW.field_group_id
       FOR UPDATE;
    IF EXISTS (
        SELECT 1
          FROM rights_cells
         WHERE field_group_id = NEW.field_group_id
    ) THEN
        RAISE EXCEPTION 'a referenced rights field group cannot be insert-expanded; create a new lineage'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rights_field_group_members_reject_referenced_insert
    BEFORE INSERT ON rights_field_group_members
    FOR EACH ROW EXECUTE FUNCTION rights_reject_referenced_field_group_expansion();

-- Registry state is authoritative only after an explicit synchronization.
-- Existing rows deliberately remain NULL: guessing FALSE would re-enable a
-- source whose operational state is unknown during an upgraded deployment.
ALTER TABLE sources
    ADD COLUMN IF NOT EXISTS kill_switch_engaged BOOLEAN NULL DEFAULT NULL;

COMMENT ON COLUMN sources.kill_switch_engaged IS
    'Authoritative synchronized operator kill switch. NULL is legacy/unknown and refuses every distribution surface.';

-- Existing facts are intentionally not classified by inference. NULL is the
-- durable upgraded state until an explicit operator/app writer identifies the
-- output as source-normalized or derived with its complete dependency set.
ALTER TABLE facts
    ADD COLUMN IF NOT EXISTS output_kind TEXT NULL DEFAULT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'facts_output_kind_allowed'
    ) THEN
        ALTER TABLE facts
            ADD CONSTRAINT facts_output_kind_allowed CHECK (
                output_kind IS NULL OR output_kind IN ('NORMALIZED_FACT', 'DERIVED_METRIC')
            );
    END IF;
END;
$$;

COMMENT ON COLUMN facts.output_kind IS
    'Immutable classified output kind. NULL means legacy/ambiguous and is never query-authorized.';

CREATE OR REPLACE FUNCTION facts_validate_output_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    current_kind TEXT;
BEGIN
    -- A derived writer inserts an unclassified row, appends every dependency,
    -- then classifies it in the same transaction. Deferred triggers retain the
    -- event's NEW image, so inspect the committed candidate row instead.
    SELECT output_kind INTO current_kind FROM facts WHERE id = NEW.id;
    IF current_kind IS NULL THEN
        RAISE EXCEPTION 'a new or changed fact must have an explicit output kind'
            USING ERRCODE = '23514';
    END IF;
    IF current_kind = 'DERIVED_METRIC' AND NOT EXISTS (
        SELECT 1 FROM fact_dependencies WHERE derived_fact_id = NEW.id
    ) THEN
        RAISE EXCEPTION 'a derived fact must commit with a non-empty dependency set'
            USING ERRCODE = '23514';
    END IF;
    IF current_kind = 'NORMALIZED_FACT' AND EXISTS (
        SELECT 1 FROM fact_dependencies WHERE derived_fact_id = NEW.id
    ) THEN
        RAISE EXCEPTION 'a normalized fact cannot own derived dependencies'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER facts_output_contract_deferred
    AFTER INSERT OR UPDATE OF output_kind ON facts
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION facts_validate_output_contract();

CREATE OR REPLACE FUNCTION facts_reject_output_kind_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.output_kind IS NOT NULL AND NEW.output_kind IS DISTINCT FROM OLD.output_kind THEN
        RAISE EXCEPTION 'a classified fact output kind is immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER facts_output_kind_immutable
    BEFORE UPDATE OF output_kind ON facts
    FOR EACH ROW EXECUTE FUNCTION facts_reject_output_kind_mutation();

CREATE OR REPLACE FUNCTION fact_dependencies_require_open_classification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    derived_kind TEXT;
    input_kind TEXT;
BEGIN
    SELECT output_kind INTO derived_kind
      FROM facts
     WHERE id = NEW.derived_fact_id
       FOR UPDATE;
    IF derived_kind IS NOT NULL THEN
        RAISE EXCEPTION 'a classified fact dependency set is immutable'
            USING ERRCODE = '55000';
    END IF;
    SELECT output_kind INTO input_kind
      FROM facts
     WHERE id = NEW.input_fact_id;
    IF input_kind IS NULL THEN
        RAISE EXCEPTION 'a derived dependency input must have an explicit output kind'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER fact_dependencies_require_open_classification_insert
    BEFORE INSERT ON fact_dependencies
    FOR EACH ROW EXECUTE FUNCTION fact_dependencies_require_open_classification();
