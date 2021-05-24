
CREATE TABLE users(
    phone_no varchar(16) NOT NULL,
    public_key text,
    password CHAR(60) NOT NULL,
    id SERIAL NOT NULL PRIMARY KEY
);

CREATE TABLE contacts(
    id SERIAL NOT NULL PRIMARY KEY,
    user_id SERIAL NOT NULL REFERENCES users(id),
    contact_id SERIAL NOT NULL REFERENCES users(id)
);