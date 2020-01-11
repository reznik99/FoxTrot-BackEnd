const jwt = require('jsonwebtoken');
const jwtSecret = require('./config/jwtConfig');

const createRoutes = (app, passport) => {
    app.get("/", (req, res, next) => {
        //todo
        res.send("Hello world");
    });

    app.post('/login', (req, res, next) => {
        passport.authenticate('login', (err, user, info) => {
            if (err) {
                console.error(`error ${err}`);
            }
            if (info !== undefined) {
                console.error(info.message);
                if (info.message === 'Invalid username and/or password') {
                    res.status(401).send(info.message);
                } else {
                    res.status(403).send(info.message);
                }
            } else {
                // todo:
                // Should get user data from database
                req.logIn(user, () => {
                    const token = jwt.sign({ id: user.username }, jwtSecret.secret, {
                        expiresIn: 60 * 60,
                    });
                    res.status(200).send({
                        auth: true,
                        token,
                        message: 'user found & logged in',
                    });
                });
            }
        })(req, res, next);
    });

    app.post('/signup', (req, res, next) => {
        passport.authenticate('register', (err, user, info) => {
            if (err) {
                console.error(`error ${err}`);
            }
            if (info !== undefined) {
                console.error(info.message);
                res.status(403).send(info.message);
            } else {
                // Todo
                res.status(200).send({
                    message: 'user created',
                });
            }
        })(req, res, next);
    });

    // Protected Routes
    app.post('/sendMessage', (req, res, next) => {
        passport.authenticate('jwt', (err, users, info) => {
            // Todo

        })(req, res, next);
    });
    app.post('/addContact', (req, res, next) => {
        passport.authenticate('jwt', (err, users, info) => {
            // Todo

        })(req, res, next);
    });
};

module.exports = createRoutes;
