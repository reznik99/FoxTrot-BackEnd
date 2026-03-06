
CREATE TABLE users(
    id SERIAL NOT NULL PRIMARY KEY,
    phone_no varchar(16) NOT NULL,
    password CHAR(60) NOT NULL,
    public_key text,
    fcm_token text,
    online boolean DEFAULT false,
    last_seen timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_users_phone_no ON users(phone_no);

CREATE TABLE contacts(
    user_id int NOT NULL REFERENCES users(id),
    contact_id int NOT NULL REFERENCES users(id),
    PRIMARY KEY (user_id, contact_id)
);

CREATE INDEX idx_contacts_contact_id ON contacts(contact_id);

CREATE TABLE messages(
    id SERIAL NOT NULL PRIMARY KEY,
    user_id int NOT NULL REFERENCES users(id),
    contact_id int NOT NULL REFERENCES users(id),
    sent_at timestamptz NOT NULL DEFAULT now(),
    seen boolean DEFAULT FALSE,
    message text NOT NULL
);

CREATE INDEX idx_messages_user_id_sent_at ON messages(user_id, sent_at DESC);
CREATE INDEX idx_messages_contact_id_sent_at ON messages(contact_id, sent_at DESC);