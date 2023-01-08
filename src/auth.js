
const LocalStrategy = require('passport-local').Strategy;
const JWTstrategy = require('passport-jwt').Strategy;
const ExtractJWT = require('passport-jwt').ExtractJwt;

const bcrypt = require('bcryptjs');
const jwtConfig = require('./config/jwtConfig');
const pool = require('./config/dbConfig').pool;

const BCRYPT_SALT_ROUNDS = 12;

module.exports = (passport) => {
    passport.serializeUser((user, done) => done(null, user.id));

    passport.deserializeUser((id, done) => {
        User.findById(id, (err, user) => {
            done(err, user);
        });
    });


    passport.use('register', new LocalStrategy({
        usernameField: 'phone_no',
        passwordField: 'password',
        session: false,
    }, async (phone_no, password, done) => {
        try {
            const existingRes = await pool.query('SELECT phone_no FROM users WHERE phone_no=$1', [phone_no])
            if (existingRes.rows.length > 0)
                return done(null, false, { message: 'Username already taken!' })

            // Hash password and create new user
            const hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS)
            const res = await pool.query('INSERT INTO users(phone_no, password) VALUES ($1, $2) RETURNING *', [phone_no, hash])

            return done(null, res.rows[0]);

        } catch (err) {
            console.error("Signup err: ", err)
            return done(null, false, { message: 'Error occoured during registration. Please try again later.' })
        }
    }));

    passport.use('login', new LocalStrategy({
        usernameField: 'phone_no',
        passwordField: 'password',
        session: false,
    }, async (phone_no, password, done) => {
        try {
            const results = await pool.query('SELECT * FROM users WHERE phone_no=$1', [phone_no]);
            if (results.rows.length !== 1)
                return done(null, false, { message: 'Invalid username and/or password' });

            // Compare hashes
            const user = results.rows[0];
            const equal = await bcrypt.compare(password, user.password)
            if (!equal) return done(null, false, { message: 'Invalid username and/or password' });

            return done(null, user);
        } catch (err) {
            console.error("Login err: ", err)
            return done(null, false, { message: 'Error during login process. Try again later' })
        }
    }));

    const opts = {
        jwtFromRequest: ExtractJWT.fromAuthHeaderWithScheme('JWT'),
        secretOrKey: jwtConfig.secret,
    };

    passport.use('jwt', new JWTstrategy(opts, async (jwt_payload, done) => {
        try {
            // Not sure if this check is necessary
            const results = await pool.query('SELECT * FROM users WHERE id=$1', [jwt_payload.id])
            if (results.rows.length < 1)
                return done(null, false, { message: 'Invalid Token!' });

            return done(null, results.rows[0]);
        } catch (err) {
            console.error("JWT Verify err: ", err)
            return done(null, false, { message: 'Error during Token verification process. Try again later' })
        }
    }));
};
