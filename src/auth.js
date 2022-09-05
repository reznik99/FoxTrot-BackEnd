
const LocalStrategy = require('passport-local').Strategy;
const JWTstrategy = require('passport-jwt').Strategy;
const ExtractJWT = require('passport-jwt').ExtractJwt;

const bcrypt = require('bcryptjs');
const jwtConfig = require('./config/jwtConfig');
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
        session: false,
    }, (phone_no, password, done) => {

        pool.query('SELECT phone_no FROM users WHERE phone_no=$1', [phone_no], (err, results) => {
            if (err) {
                console.error(err.stack)
            } else {
                if (results.rows.length > 0)
                    return done(null, false, { message: 'Phone number already registered!' });

                // Create new user (HASH PASSWORD)
                bcrypt.hash(password, BCRYPT_SALT_ROUNDS, (err, hash) => {
                    pool.query('INSERT INTO users(phone_no, password) VALUES ($1, $2) RETURNING *', [phone_no, hash], (err, results) => {
                        // Catch both bcrypt and psql errors, log them and return generic internal error
                        if (err) {
                            console.error(err)
                            return done(null, false, { message: 'Error occoured during registration. Please try again later.' });
                        }
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
        secretOrKey: jwtConfig.secret,
    };

    passport.use('jwt', new JWTstrategy(opts, (jwt_payload, done) => {
        //does user actually exist? This might not be necessary because JWT falsification shouldn't be possible without secret.
        pool.query('SELECT * FROM users WHERE id=$1', [jwt_payload.id], (err, results) => {
            if (err) {
                console.log(err.stack)
            } else {
                if (results.rows.length < 1)
                    return done(null, false, { message: 'Invalid Token!' });

                //Valid Token
                return done(null, results.rows[0]);
            }
        });
    }),
    );
};
