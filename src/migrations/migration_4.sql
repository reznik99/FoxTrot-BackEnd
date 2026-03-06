BEGIN;

-- Reverse contact lookup: "who has this user as a contact?"
-- Used by online status broadcasting (sockets.ts)
CREATE INDEX idx_contacts_contact_id ON contacts(contact_id);

-- Message lookups by participant, ordered by time
-- Used by getConversations: WHERE (user_id = $1 OR contact_id = $1) AND sent_at > $2 ORDER BY sent_at DESC
CREATE INDEX idx_messages_user_id_sent_at ON messages(user_id, sent_at DESC);
CREATE INDEX idx_messages_contact_id_sent_at ON messages(contact_id, sent_at DESC);

-- Phone number / username lookup for login/register (exact match)
-- Also enforces uniqueness at the DB level (currently only enforced by application logic)
CREATE UNIQUE INDEX idx_users_phone_no ON users(phone_no);

COMMIT;
