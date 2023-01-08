BEGIN;

ALTER TABLE users ADD COLUMN fcm_token text;

COMMIT;