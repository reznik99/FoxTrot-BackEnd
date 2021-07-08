const jwt = require('jsonwebtoken')
const jwtSecret = require('./config/jwtConfig')
const pool = require('./config/dbConfig').pool

const createRoutes = (app, passport) => {

    app.post('/login', (req, res, next) => {
        passport.authenticate('login', (err, user, info) => {
            console.log(`/login called by user ${user.phone_no}`)

            if (err) {
                console.error(`error ${err}`)
                res.status(500)
            }

            else if (info !== undefined) {
                console.error(info.message)
                if (info.message === 'Invalid username and/or password')
                    res.status(401).send(info.message)
                else
                    res.status(403).send(info.message)
            } else {
                req.logIn(user, () => {
                    const token = jwt.sign({ id: user.id, phone_no: user.phone_no }, jwtSecret.secret, {
                        expiresIn: 60 * 60,
                    })
                    res.status(200).send({
                        auth: true,
                        token,
                        message: 'user found & logged in',
                    })
                })
            }
        })(req, res, next)
    })

    app.post('/signup', (req, res, next) => {
        passport.authenticate('register', (err, user, info) => {
            if (err) {
                console.error(`error ${err}`)
                res.status(500)
            }
            if (info !== undefined) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                res.status(200).send({
                    message: 'user created',
                })
            }
        })(req, res, next)
    })

    // Protected Routes
    app.post('/savePublicKey', (req, res, next) => {
        passport.authenticate('jwt', (err, user, info) => {
            console.log(`/savePublicKey called by user ${user.phone_no}`)

            if (err) {
                console.error(`error ${err}`)
                res.status(500)
            }
            if (info !== undefined) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                let publicKey = req.body.publicKey
                pool.query('UPDATE users SET public_key = $1 WHERE id = $2', [publicKey, user.id])
                    .then(result => {
                        res.status(200).send({ message: 'Stored public key' })
                    })
                    .catch(err => {
                        console.error(err)
                        res.status(500)
                    })
            }
        })(req, res, next)
    })
    app.post('/sendMessage', (req, res, next) => {
        passport.authenticate('jwt', (err, user, info) => {
            console.log(`/sendMessage called by user ${user.phone_no}`)

            if (err) {
                console.error(`error ${err}`)
                res.status(500)
            }
            if (info !== undefined) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                let { message, contact_id } = req.body
                console.log(message)
                console.log(contact_id)
                pool.query('INSERT INTO messages(user_id, contact_id, message, seen) VALUES( $1, $2, $3, $4)', [user.id, contact_id, message, false])
                    .then(result => {
                        res.status(200).send({ message: 'Message Sent' })
                    })
                    .catch(err => {
                        console.error(err)
                        res.status(500)
                    })
            }
        })(req, res, next)
    })
    app.post('/addContact', (req, res, next) => {
        passport.authenticate('jwt', (err, user, info) => {
            console.log(`/addContact called by user ${user.phone_no}`)

            if (err) {
                console.error(`error ${err}`)
                res.status(500)
            }

            if (info !== undefined) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                let data = req.body
                pool.query('INSERT INTO contacts VALUES ($1, $2) RETURNING *', [user.id, data.id])
                    .then(result => {
                        res.status(200).send({
                            message: 'Contact added'
                        })
                    })
                    .catch(err => {
                        console.error(`Cannot add existing contact`)
                        res.status(500).send({
                            message: 'Contact already added'
                        })
                    })
            }
        })(req, res, next)
    })
    app.delete('/removeContact', (req, res, next) => {
        passport.authenticate('jwt', (err, user, info) => {
            console.log(`/removeContact called by user ${user.phone_no}`)

            if (err) {
                console.error(`error ${err}`)
                res.status(500)
            }

            if (info !== undefined) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                let data = req.body
                pool.query('DELETE FROM contacts WHERE user_id = $1 AND contact_id = $2', [user.id, data.id], (err, result) => {
                    if (err) {
                        console.error(err.stack)
                    } else {
                        res.status(200).send({
                            message: 'Contact removed'
                        })
                    }
                })
            }
        })(req, res, next)
    })
    app.get('/getContacts', (req, res, next) => {
        passport.authenticate('jwt', (err, user, info) => {
            console.log(`/getContacts called by user ${user.phone_no}`)

            if (err)
                console.error(`error ${err}`)

            if (info !== undefined) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                let data = req.body
                pool.query('SELECT id, phone_no, public_key FROM users WHERE id IN (SELECT contact_id FROM contacts WHERE user_id = $1)', [user.id], (err, result) => {
                    if (err) {
                        console.error(err.stack)
                    } else {
                        res.status(200).send(result.rows)
                    }
                })
            }
        })(req, res, next)
    })
    app.get('/searchUsers/:prefix', (req, res, next) => {
        passport.authenticate('jwt', (err, user, info) => {
            console.log(`/searchUsers/:prefix called by user ${user.phone_no}`)

            if (err) console.error(`error ${err}`)

            if (info !== undefined) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                const prefix = req.params.prefix
                pool.query("SELECT id, phone_no, public_key FROM users WHERE phone_no LIKE $1 AND phone_no != $2 LIMIT 10", [prefix + '%', user.phone_no])
                    .then(result => {
                        res.status(200).send(result.rows)

                    })
                    .catch(err => {
                        res.status(500)
                        console.error(err.stack)
                    })
            }
        })(req, res, next)
    })
    app.get('/getConversations', (req, res, next) => {
        passport.authenticate('jwt', (err, user, info) => {
            console.log(`/getConversations called by user ${user.phone_no}`)

            if (err) console.error(`error ${err}`)

            if (info !== undefined) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                pool.query("SELECT message, sent_at, seen, u1.phone_no AS reciever, u1.id AS reciever_id, u2.phone_no AS sender, u2.id AS sender_id FROM messages AS m INNER JOIN users AS u1 ON m.contact_id = u1.id INNER JOIN users AS u2 ON m.user_id = u2.id  WHERE user_id = $1 OR contact_id = $1 ORDER BY sent_at DESC LIMIT 100", [user.id])
                    .then(result => {
                        res.status(200).send(result.rows)
                    })
                    .catch(err => {
                        res.status(500)
                        console.error(err.stack)
                    })
            }
        })(req, res, next)
    })
    app.get('/validateToken', (req, res, next) => {
        console.log(`/validateToken called`)
        passport.authenticate('jwt', (err, user, info) => {
            if (err || info !== undefined) {
                console.error(info.message || err)
                res.status(401).send({ valid: false }) // token expired!
            } else {
                res.status(200).send({ valid: true })  // token valid
            }
        })(req, res, next)
    })
}

module.exports = createRoutes
