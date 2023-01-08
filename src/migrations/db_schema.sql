
CREATE TABLE users(
    id SERIAL NOT NULL PRIMARY KEY,
    phone_no varchar(16) NOT NULL,
    password CHAR(60) NOT NULL,
    public_key text,
    fcm_token text
);

CREATE TABLE contacts(
    user_id int NOT NULL REFERENCES users(id),
    contact_id int NOT NULL REFERENCES users(id),
    PRIMARY KEY (user_id, contact_id)
);

CREATE TABLE messages(
    id SERIAL NOT NULL PRIMARY KEY,
    user_id int NOT NULL REFERENCES users(id),
    contact_id int NOT NULL REFERENCES users(id),
    sent_at timestamptz NOT NULL DEFAULT now(),
    seen boolean DEFAULT FALSE,
    message text NOT NULL
);