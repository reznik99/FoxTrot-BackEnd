BEGIN;

ALTER TABLE users 
    ADD COLUMN online boolean DEFAULT false,
    ADD COLUMN last_seen timestamptz NOT NULL DEFAULT now();

COMMIT;