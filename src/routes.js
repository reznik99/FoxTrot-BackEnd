const jwt = require('jsonwebtoken')
const jwtSecret = require('./config/jwtConfig')
const pool = require('./config/dbConfig').pool
const { wsClients } = require('./websockets')

const admin = require("firebase-admin");
const serviceAccount = require("./config/foxtrot-push-notifications-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const devices = new Map()

const createRoutes = (app, passport) => {

    app.post('/foxtrot-api/login', (req, res, next) => {
        passport.authenticate('login', (err, user, info) => {
            console.log(`/login called by user ${user.phone_no}`)

            if (err) {
                console.error(`error ${err}`)
                res.status(500).send()
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

    app.post('/foxtrot-api/signup', (req, res, next) => {
        passport.authenticate('register', (err, user, info) => {
            if (err) {
                console.error(`error ${err}`)
                res.status(500).send()
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
    app.post('/foxtrot-api/savePublicKey', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            console.log(`/savePublicKey called by user ${user.phone_no}`)

            if (err) {
                console.error(`error ${err}`)
                res.status(500).send()
            }
            if (info !== undefined) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                try {
                    const { rows } = await pool.query('SELECT public_key from users WHERE id = $1', [user.id])
                    
                    if (!rows[0]?.public_key) {
                        await pool.query('UPDATE users SET public_key = $1 WHERE id = $2', [req.body.publicKey, user.id])
                        res.status(200).send({ message: 'Stored public key' })
                    } else {
                        console.warn(`User ${user.phone_no} trying to overwrite account\'s public key. Rejected`)
                        res.status(403).send()
                    }
                } catch (error) {
                    console.error(error)
                    res.status(500).send()
                }
            }
        })(req, res, next)
    })
    app.post('/foxtrot-api/sendMessage', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            console.log(`/sendMessage called by user ${user.phone_no}`)

            if (err) {
                console.error(`error ${err}`)
                res.status(500).send()
            }
            if (info !== undefined) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                let { message, contact_id } = req.body

                try {
                    // Attempt to send the message directly to the online user, as a websocket -> local-notification
                    const targetWS = wsClients.get(contact_id)
                    if (targetWS) {
                        console.log('Recipient online! Using websocket')
                        const msg = {
                            sender: user.phone_no,
                            sender_id: user.id,
                            message: message,
                            reciever: targetWS.session.phone_no,
                            reciever_id: targetWS.session.id,
                            sent_at: Date.now(),
                            seen: false
                        }
                        targetWS.send(JSON.stringify(msg))
                    // Attempt to send the message to the user -> push-notification
                    } else if(devices.has(contact_id)){
                        console.log('Recipient offline! Sending Push notification')
                        const fcmID = await admin.messaging().send({
                            token: devices.get(contact_id),
                            notification: {
                                title: `Message from ${contact_id}`,
                                body: message,
                                imageUrl: `https://robohash.org/${contact_id}`,
                            },
                        });
                        console.log('Msg fcm id:', fcmID)
                    }

                    // Store message
                    await pool.query('INSERT INTO messages(user_id, contact_id, message, seen) VALUES( $1, $2, $3, $4)', [user.id, contact_id, message, false])
                    
                    res.status(200).send({ message: 'Message Sent' })
                } catch (err) {
                    console.error('Error:', err)
                    res.status(500).send()
                }
            }
        })(req, res, next)
    })
    app.post('/foxtrot-api/addContact', (req, res, next) => {
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
    app.delete('/foxtrot-api/removeContact', (req, res, next) => {
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
    app.get('/foxtrot-api/getContacts', (req, res, next) => {
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
    app.get('/foxtrot-api/searchUsers/:prefix', (req, res, next) => {
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
    app.get('/foxtrot-api/getConversations', (req, res, next) => {
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
    app.get('/foxtrot-api/validateToken', (req, res, next) => {
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
    app.post('/foxtrot-api/registerPushNotifications', (req, res, next) => {
        console.log('/registerPushNotifications called')
        passport.authenticate('jwt', async (err, user, info) => {

            if (err) {
                console.error(`error ${err}`)
                res.status(500).send()
            }
            if (info !== undefined) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                try {
                    console.log(`UserDevice token ${req.body.token}`)
                    // TODO: Store Device Token in Database for persistance
                    devices.set(user.id, req.body.token)
                    res.status(200).send('Registered')
                } catch (error) {
                    console.error(error)
                    res.status(500).send()
                }
            }
        })(req, res, next)
    })
}

module.exports = createRoutes
