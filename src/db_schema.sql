
CREATE TABLE users(
    phone_no varchar(16) NOT NULL,
    password CHAR(60) NOT NULL,
    id SERIAL NOT NULL PRIMARY KEY
);

CREATE TABLE contacts(
    user1 SERIAL NOT NULL REFERENCES users(id),
    user2 SERIAL NOT NULL REFERENCES users(id),
    nickname varchar(20) NOT NULL,
    PRIMARY KEY(user1, user2)
);