
import firebase from "firebase-admin";
import { PassportStatic } from "passport";
import { Express } from "express";
import { sign } from 'jsonwebtoken';

import { jwtSecret } from './config/jwtConfig';
import { pool } from './config/dbConfig';
import { wsClients } from './sockets';
import serviceAccount from "./config/foxtrot-push-notifications-firebase-adminsdk.json";

firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount as firebase.ServiceAccount),
});

export const devices = new Map()

export const CreateRoutes = (app: Express, passport: PassportStatic) => {

    app.post('/foxtrot-api/login', (req, res, next) => {
        passport.authenticate('login', (err, user, info) => {
            if (err) {
                console.error(err.message || err)
                res.status(500).send()
            } else if (info) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                req.logIn(user, () => {
                    const token = sign({ id: user.id, phone_no: user.phone_no }, jwtSecret, {
                        expiresIn: 60 * 60,
                    })
                    res.status(200).send({
                        auth: true,
                        token,
                        user_data: { id: user.id, phone_no: user.phone_no, public_key: user.public_key },
                        message: 'user found & logged in',
                    })
                })
            }
        })(req, res, next)
    })
    app.post('/foxtrot-api/signup', (req, res, next) => {
        passport.authenticate('register', (err, user, info) => {
            if (err) {
                console.error(err.message || err)
                res.status(500).send()
            } else if (info) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                res.status(200).send({
                    user_data: { id: user.id, phone_no: user.phone_no, public_key: user.public_key },
                    message: 'user created',
                })
            }
        })(req, res, next)
    })

    // Protected Routes
    app.post('/foxtrot-api/savePublicKey', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                console.error(err.message || err)
                res.status(500).send()
            } else if (info) {
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
                } catch (err: any) {
                    console.error(err.message || err)
                    res.status(500).send()
                }
            }
        })(req, res, next)
    })
    app.post('/foxtrot-api/sendMessage', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                console.error(err.message || err)
                res.status(500).send()
            } else if (info) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                let { message, contact_id, contact_phone_no } = req.body

                try {
                    // Store message asyncronously
                    const result = await pool.query('INSERT INTO messages(user_id, contact_id, message, seen) VALUES( $1, $2, $3, $4) returning id', [user.id, contact_id, message, false])

                    // Attempt to send the message directly to the online user, as a websocket -> local-notification
                    const targetWS = wsClients.get(contact_id)
                    if (targetWS) {
                        console.log('Recipient online! Using websocket')
                        const data = {
                            id: result.rows[0]?.id,
                            sender: user.phone_no,
                            sender_id: user.id,
                            message: message,
                            reciever: targetWS.session.phone_no,
                            reciever_id: targetWS.session.id,
                            sent_at: Date.now(),
                            seen: false
                        }
                        const msg = {
                            cmd: 'MSG',
                            data: data,
                        }
                        targetWS.send(JSON.stringify(msg))
                    } else {
                        // Attempt to send the message to the user -> push-notification
                        console.log('Recipient offline! Sending Push notification')
                        const fcm_token = await getFCMToken(contact_id)
                        if (!fcm_token) {
                            console.warn(`/sendMessage: No fcm_token found for ${contact_phone_no}`)
                            res.status(200).send({ message: 'Message Sent. Push Notification failed to send' })
                            return
                        }
                        await firebase.messaging().send({
                            token: fcm_token,
                            notification: {
                                title: `Message from ${user.phone_no}`,
                                body: message.substring(0, 200),
                                imageUrl: `https://robohash.org/${user.id}`,
                            },
                        });
                    }

                    res.status(200).send({ message: 'Message Sent' })
                } catch (err: any) {
                    console.error(err.message || err)
                    res.status(500).send()
                }
            }
        })(req, res, next)
    })
    app.post('/foxtrot-api/addContact', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                console.error(err.message || err)
                res.status(500).send()
            } else if (info) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                try {
                    let data = req.body
                    await pool.query('INSERT INTO contacts VALUES ($1, $2)', [user.id, data.id])
                    const results = await pool.query('SELECT * FROM users WHERE id = $1', [data.id])
                    if (!results.rows[0]) throw new Error("User not found")

                    res.status(200).send({
                        message: 'Contact added',
                        ...results.rows[0]
                    })
                } catch (err: any) {
                    console.error(err.message || err)
                    res.status(500).send({
                        message: 'Failed to add contact'
                    })
                }
            }
        })(req, res, next)
    })
    app.delete('/foxtrot-api/removeContact', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                console.error(err.message || err)
                res.status(500).send()
            } else if (info) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                try {
                    let data = req.body
                    await pool.query('DELETE FROM contacts WHERE user_id = $1 AND contact_id = $2', [user.id, data.id])
                    res.status(200).send({
                        message: 'Contact removed'
                    })
                }
                catch (err: any) {
                    console.error(err.message || err)
                    res.status(500).send()
                }
            }
        })(req, res, next)
    })
    app.get('/foxtrot-api/getContacts', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                console.error(err.message || err)
                res.status(500).send()
            } else if (info) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                try {
                    const results = await pool.query('SELECT id, phone_no, public_key FROM users WHERE id IN (SELECT contact_id FROM contacts WHERE user_id = $1)', [user.id])
                    res.status(200).send(results.rows)
                } catch (err: any) {
                    console.error(err.message || err)
                    res.status(500).send()
                }
            }
        })(req, res, next)
    })
    app.get('/foxtrot-api/searchUsers/:prefix', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                console.error(err.message || err)
                res.status(500).send()
            } else if (info) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                try {
                    const prefix = req.params.prefix
                    const result = await pool.query("SELECT id, phone_no, public_key FROM users WHERE phone_no LIKE $1 AND phone_no != $2 LIMIT 10", [prefix + '%', user.phone_no])
                    res.status(200).send(result.rows)
                } catch (err: any) {
                    console.error(err.message || err)
                    res.status(500).send()
                }
            }
        })(req, res, next)
    })
    app.get('/foxtrot-api/getConversations', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                console.error(err.message || err)
                res.status(500).send()
            } else if (info) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                try {
                    const since = new Date(parseInt(req.query.since as string || '0'))
                    const result = await pool.query(`
                        SELECT m.id, message, sent_at, seen, u1.phone_no AS reciever, u1.id AS reciever_id, u2.phone_no AS sender, u2.id AS sender_id 
                            FROM messages AS m 
                            INNER JOIN users AS u1 ON m.contact_id = u1.id 
                            INNER JOIN users AS u2 ON m.user_id = u2.id 
                        WHERE (user_id = $1 OR contact_id = $1) AND sent_at > $2::timestamptz
                        ORDER BY sent_at DESC 
                        LIMIT 1000`, [user.id, since])

                    res.status(200).send(result.rows)
                } catch (err: any) {
                    console.error(err.message || err)
                    res.status(500).send()
                }
            }
        })(req, res, next)
    })
    app.get('/foxtrot-api/validateToken', (req, res, next) => {
        passport.authenticate('jwt', (err, user, info) => {
            if (err || info) {
                console.error(info.message || err)
                res.status(401).send({ valid: false }) // token expired!
            } else {
                res.status(200).send({ valid: true })  // token valid
            }
        })(req, res, next)
    })
    app.post('/foxtrot-api/registerPushNotifications', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                console.error(err.message || err)
                res.status(500).send()
            } else if (info) {
                console.error(info.message)
                res.status(403).send(info.message)
            } else {
                try {
                    // Cache token in memory and in Database
                    devices.set(user.id, req.body.token)
                    await pool.query('UPDATE users SET fcm_token = $1 WHERE id = $2', [req.body.token, user.id])
                    res.status(200).send('Registered')
                } catch (err: any) {
                    console.error(err.message || err)
                    res.status(500).send()
                }
            }
        })(req, res, next)
    })
}

// Fetches the fcm_token for push notifications for the specified user and caches it
const getFCMToken = async (user_id: string) => {
    if (devices.has(user_id)) return devices.get(user_id)

    const res = await pool.query('SELECT fcm_token FROM users WHERE id = $1', [user_id])
    devices.set(user_id, res.rows[0].fcm_token)
    return res.rows[0].fcm_token
}
