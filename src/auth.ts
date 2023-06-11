
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as JWTstrategy, ExtractJwt } from 'passport-jwt';
import { PassportStatic } from 'passport';
import { hash, compare } from 'bcryptjs';

import { secret } from 'config/jwtConfig';
import { pool } from 'config/dbConfig';

const BCRYPT_SALT_ROUNDS = 12;

export const InitAuth = (passport: PassportStatic) => {
    passport.serializeUser((user: any, done) => done(null, user.id));

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
            const hashedPw = await hash(password, BCRYPT_SALT_ROUNDS)
            const res = await pool.query('INSERT INTO users(phone_no, password) VALUES ($1, $2) RETURNING *', [phone_no, hashedPw])

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
            const equal = await compare(password, user.password)
            if (!equal) return done(null, false, { message: 'Invalid username and/or password' });

            return done(null, user);
        } catch (err) {
            console.error("Login err: ", err)
            return done(null, false, { message: 'Error during login process. Try again later' })
        }
    }));

    const opts = {
        jwtFromRequest: ExtractJwt.fromAuthHeaderWithScheme('JWT'),
        secretOrKey: secret,
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
