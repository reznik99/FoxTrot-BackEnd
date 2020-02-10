
const LocalStrategy = require('passport-local').Strategy;
const JWTstrategy = require('passport-jwt').Strategy;
const ExtractJWT = require('passport-jwt').ExtractJwt;

const bcrypt = require('bcryptjs');
const jwtSecret = require('./config/jwtConfig');
const pool = require('./config/dbConfig').pool;

const BCRYPT_SALT_ROUNDS = 12;

module.exports = (passport) => {
    passport.serializeUser(function (user, done) {
        done(null, user.id);
    });

    passport.deserializeUser(function (id, done) {
        User.findById(id, function (err, user) {
            done(err, user);
        });
    });


    passport.use('register', new LocalStrategy({
        usernameField: 'phone_no',
        passwordField: 'password',
        passReqToCallback: true,
        session: false,
    }, (req, phone_no, password, done) => {

        pool.query('SELECT phone_no FROM users WHERE phone_no=$1', [phone_no], (err, results) => {
            if (err) {
                console.log(err.stack)
            } else {
                if (results.rows.length > 0)
                    return done(null, false, { message: 'Phone number already registered' });

                // Create new user (HASH PASSWORD)
                bcrypt.hash(password, BCRYPT_SALT_ROUNDS, (err, hash) => {
                    pool.query('INSERT INTO users VALUES ($1, $2) RETURNING *', [phone_no, hash], (err, results) => {
                        return done(null, results.rows[0]);
                    });
                });
            }
        });
    })
    );

    passport.use('login', new LocalStrategy({
        usernameField: 'phone_no',
        passwordField: 'password',
        session: false,
    }, (phone_no, password, done) => {

        pool.query('SELECT * FROM users WHERE phone_no=$1', [phone_no], (err, results) => {
            if (err) {
                console.log(err.stack)
            } else {
                if (results.rows.length < 1)
                    return done(null, false, { message: 'Username doesn\'t exist' });

                // Compare hashes
                let user = results.rows[0];

                bcrypt.compare(password, user.password).then(response => {
                    // Invalid credentials
                    if (response != true) {
                        return done(null, false, { message: 'Invalid username and/or password' });
                    }
                    // Valid credentials
                    return done(null, user);
                });
            }
        });
    }
    ));

    const opts = {
        jwtFromRequest: ExtractJWT.fromAuthHeaderWithScheme('JWT'),
        secretOrKey: jwtSecret.secret,
    };

    passport.use('jwt', new JWTstrategy(opts, (jwt_payload, done) => {
        try {
            User.findOne({
                where: {
                    id: jwt_payload.id,
                },
            }).then(user => {
                if (user) {
                    console.log('user found in db in passport');
                    done(null, user);
                } else {
                    console.log('user not found in db');
                    done(null, false);
                }
            });
        } catch (err) {
            done(err);
        }
    }),
    );
};
