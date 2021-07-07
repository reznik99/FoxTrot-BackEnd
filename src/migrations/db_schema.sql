
CREATE TABLE users(
    phone_no varchar(16) NOT NULL,
    public_key text,
    password CHAR(60) NOT NULL,
    id SERIAL NOT NULL PRIMARY KEY
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
    message text NOT NULL,
    sent_at timestamptz NOT NULL DEFAULT now(),
    seen boolean DEFAULT FALSE
);