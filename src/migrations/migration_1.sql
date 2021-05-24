BEGIN;

ALTER TABLE users ADD COLUMN public_key text;

COMMIT;