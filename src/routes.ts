
import { PassportStatic } from 'passport';
import { Express, Request } from 'express';
import { sign } from 'jsonwebtoken';
import expressBasicAuth from 'express-basic-auth';
import promClient from 'prom-client';
import { createHmac } from 'crypto';

import { ServerConfig, pool } from './config/envConfig';
import { messagesCounter } from './middlware/metrics';
import { wsClients, broadcastKeyRotation } from './sockets';
import { firebaseMessaging } from '.';
import { logger } from './middlware/log';
import { ALLOWED_MEDIA_TYPES, generateUploadUrl, generateDownloadUrl } from './storage';


export const devices = new Map<number, string>();

/** Passport callback outcomes: `err` is a server fault, `info` is a request the strategy rejected (bad credentials, expired or invalid JWT). */
function logAuthError(req: Request, err: unknown) {
    logger.error({ err, route: req.path }, 'Authentication error');
}
function logAuthRejected(req: Request, info: { message?: string } | undefined, err?: unknown) {
    logger.warn({ route: req.path, reason: info?.message ?? String(err) }, 'Request rejected');
}

/** Push for an offline message recipient. Runs after the response is sent; the outcome never reaches the sender. */
async function sendPushNotificationForMessage(sender: { id: number; phone_no: string }, recipientId: number, recipientPhone: string) {
    const fcm_token = await getFCMToken(recipientId);
    if (!fcm_token) {
        logger.warn({ reciever: recipientPhone }, 'Message push skipped: no FCM token');
        return;
    }
    const messageId = await firebaseMessaging.send({
        token: fcm_token,
        notification: {
            title: `Message from ${sender.phone_no}`,
            body: 'Encrypted message',
            imageUrl: `https://robohash.org/${sender.id}?size=150x150`,
        },
        android: {
            priority: 'high',
        },
    });
    logger.debug({ reciever: recipientPhone, messageId }, 'Message push sent');
}

export const CreateRoutes = (app: Express, passport: PassportStatic) => {

    app.post('/foxtrot-api/login', (req, res, next) => {
        passport.authenticate('login', (err, user, info) => {
            if (err) {
                logAuthError(req, err);
                res.status(500).send();
            } else if (info) {
                logAuthRejected(req, info);
                res.status(403).send(info);
            } else {
                req.logIn(user, () => {
                    const token = sign({ id: user.id, phone_no: user.phone_no }, ServerConfig.JWT_SECRET, {
                        expiresIn: 60 * 60,
                    });
                    res.status(200).send({
                        auth: true,
                        token,
                        user_data: { id: user.id, phone_no: user.phone_no, public_key: user.public_key },
                        message: 'user found & logged in',
                    });
                });
            }
        })(req, res, next);
    });
    app.post('/foxtrot-api/signup', (req, res, next) => {
        passport.authenticate('register', (err, user, info) => {
            if (err) {
                logAuthError(req, err);
                res.status(500).send();
            } else if (info) {
                logAuthRejected(req, info);
                res.status(403).send(info);
            } else {
                res.status(200).send({
                    user_data: { id: user.id, phone_no: user.phone_no, public_key: user.public_key },
                    message: 'user created',
                });
            }
        })(req, res, next);
    });

    // Protected Routes
    app.post('/foxtrot-api/savePublicKey', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                logAuthError(req, err);
                res.status(500).send();
            } else if (info) {
                logAuthRejected(req, info);
                res.status(403).send(info);
            } else {
                try {
                    const query = req.body.force
                        ? 'UPDATE users SET public_key = $1 WHERE id = $2'
                        : 'UPDATE users SET public_key = $1 WHERE id = $2 AND public_key IS NULL';
                    const result = await pool.query(query, [req.body.publicKey, user.id]);
                    if (result.rowCount === 0) {
                        logger.warn({ phone_no: user.phone_no }, 'User trying to overwrite account\'s public key. Rejected');
                        res.status(403).send();
                    } else {
                        logger.info({ phone_no: user.phone_no, force: !!req.body.force }, 'User uploaded public key');
                        res.status(200).send({ message: 'Stored public key' });
                        // Notify contacts so they re-derive session keys with the new public key
                        broadcastKeyRotation(user.id, user.phone_no, req.body.publicKey);
                    }
                } catch (err: unknown) {
                    logger.error(err, 'Error in savePublicKey');
                    res.status(500).send();
                }
            }
        })(req, res, next);
    });
    app.post('/foxtrot-api/sendMessage', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                logAuthError(req, err);
                res.status(500).send();
            } else if (info) {
                logAuthRejected(req, info);
                res.status(403).send(info);
            } else {
                const { message, contact_id, contact_phone_no } = req.body;

                try {
                    // Store message asyncronously
                    const result = await pool.query('INSERT INTO messages(user_id, contact_id, message, seen) VALUES( $1, $2, $3, $4) returning id, sent_at', [user.id, contact_id, message, false]);

                    // Attempt to send the message directly to the online user, as a websocket -> local-notification
                    const targetWS = wsClients.get(contact_id);
                    if (targetWS) {
                        logger.info('Recipient online! Using websocket');
                        const data = {
                            id: result.rows[0]?.id,
                            sender: user.phone_no,
                            sender_id: user.id,
                            message: message,
                            reciever: targetWS.session.phone_no,
                            reciever_id: targetWS.session.id,
                            // The stored row's timestamp, so the websocket copy and the API copy of this message agree
                            sent_at: result.rows[0]?.sent_at?.toISOString() ?? new Date().toISOString(),
                            seen: false,
                        };
                        const msg = {
                            cmd: 'MSG',
                            data: data,
                        };
                        targetWS.send(JSON.stringify(msg));
                    } else {
                        logger.info('Recipient offline! Sending Push notification');
                        sendPushNotificationForMessage(user, contact_id, contact_phone_no).catch(err =>
                            logger.warn({ err, reciever: contact_phone_no }, 'Message push failed'),
                        );
                    }
                    messagesCounter.inc();
                    res.status(200).send({ message: 'Message Sent', id: result.rows[0]?.id });
                } catch (err: unknown) {
                    logger.error(err, 'Error in sendMessage');
                    res.status(500).send();
                }
            }
        })(req, res, next);
    });
    app.post('/foxtrot-api/addContact', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                logAuthError(req, err);
                res.status(500).send();
            } else if (info) {
                logAuthRejected(req, info);
                res.status(403).send(info);
            } else {
                try {
                    const data = req.body;
                    await pool.query('INSERT INTO contacts VALUES ($1, $2)', [user.id, data.id]);
                    const results = await pool.query('SELECT id, phone_no, public_key FROM users WHERE id = $1', [data.id]);
                    if (!results.rows[0]) throw new Error('User not found');

                    res.status(200).send({
                        message: 'Contact added',
                        ...results.rows[0],
                    });
                } catch (err: unknown) {
                    logger.error(err, 'Error in addContact');
                    res.status(500).send({
                        message: 'Failed to add contact',
                    });
                }
            }
        })(req, res, next);
    });
    app.delete('/foxtrot-api/removeContact', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                logAuthError(req, err);
                res.status(500).send();
            } else if (info) {
                logAuthRejected(req, info);
                res.status(403).send(info);
            } else {
                try {
                    const data = req.body;
                    await pool.query('DELETE FROM contacts WHERE user_id = $1 AND contact_id = $2', [user.id, data.id]);
                    res.status(200).send({
                        message: 'Contact removed',
                    });
                }
                catch (err: unknown) {
                    logger.error(err, 'Error in removeContact');
                    res.status(500).send();
                }
            }
        })(req, res, next);
    });
    app.get('/foxtrot-api/getContacts', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                logAuthError(req, err);
                res.status(500).send();
            } else if (info) {
                logAuthRejected(req, info);
                res.status(403).send(info);
            } else {
                try {
                    const results = await pool.query(`
                        SELECT u.id, u.phone_no, u.public_key, u.online, u.last_seen
                        FROM users AS u
                        INNER JOIN contacts AS c
                        ON u.id = c.contact_id
                        WHERE c.user_id = $1`, [user.id]);
                    res.status(200).send(results.rows);
                } catch (err: unknown) {
                    logger.error(err, 'Error in getContacts');
                    res.status(500).send();
                }
            }
        })(req, res, next);
    });
    app.get('/foxtrot-api/searchUsers/:prefix', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                logAuthError(req, err);
                res.status(500).send();
            } else if (info) {
                logAuthRejected(req, info);
                res.status(403).send(info);
            } else {
                try {
                    const prefix = req.params.prefix;
                    const result = await pool.query('SELECT id, phone_no, public_key FROM users WHERE phone_no ILIKE $1 AND phone_no != $2 LIMIT 10', [`${prefix}%`, user.phone_no]);
                    res.status(200).send(result.rows);
                } catch (err: unknown) {
                    logger.error(err, 'Error in searchUsers');
                    res.status(500).send();
                }
            }
        })(req, res, next);
    });
    app.get('/foxtrot-api/getConversations', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                logAuthError(req, err);
                res.status(500).send();
            } else if (info) {
                logAuthRejected(req, info);
                res.status(403).send(info);
            } else {
                try {
                    const since = new Date(parseInt(req.query.since as string || '0'));
                    const result = await pool.query(`
                        SELECT m.id, message, sent_at, seen, u1.phone_no AS reciever, u1.id AS reciever_id, u2.phone_no AS sender, u2.id AS sender_id
                            FROM messages AS m
                            INNER JOIN users AS u1 ON m.contact_id = u1.id
                            INNER JOIN users AS u2 ON m.user_id = u2.id
                        WHERE (user_id = $1 OR contact_id = $1) AND sent_at > $2::timestamptz
                        ORDER BY sent_at DESC
                        LIMIT 1000`, [user.id, since]);

                    res.status(200).send(result.rows);
                } catch (err: unknown) {
                    logger.error(err, 'Error in getConversations');
                    res.status(500).send();
                }
            }
        })(req, res, next);
    });
    app.get('/foxtrot-api/validateToken', (req, res, next) => {
        passport.authenticate('jwt', (err, user, info) => {
            if (err || info) {
                logAuthRejected(req, info, err);
                res.status(401).send({ valid: false }); // token expired!
            } else {
                res.status(200).send({ valid: true });  // token valid
            }
        })(req, res, next);
    });
    app.post('/foxtrot-api/registerPushNotifications', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                logAuthError(req, err);
                res.status(500).send();
            } else if (info) {
                logAuthRejected(req, info);
                res.status(403).send(info);
            } else {
                try {
                    // Cache token in memory and in Database
                    devices.set(user.id, req.body.token);
                    await pool.query('UPDATE users SET fcm_token = $1 WHERE id = $2', [req.body.token, user.id]);
                    res.status(200).send('Registered');
                } catch (err: unknown) {
                    logger.error(err, 'Error in registerPushNotifications');
                    res.status(500).send();
                }
            }
        })(req, res, next);
    });
    app.get('/foxtrot-api/turnServerKey', (req, res, next) => {
        passport.authenticate('jwt', (err, user, info) => {
            if (err || info) {
                logAuthRejected(req, info, err);
                res.status(401).send();
            } else {
                // Generate access credentials for TURN server for this user
                const creds = generateTURNServerCredentials(user.phone_no);
                res.status(200).send(creds);
            }
        })(req, res, next);
    });

    // Media Routes
    app.post('/foxtrot-api/media/upload-url', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                logAuthError(req, err);
                res.status(500).send();
            } else if (info) {
                logAuthRejected(req, info);
                res.status(403).send(info);
            } else {
                try {
                    const { contentType } = req.body;
                    if (!contentType || !ALLOWED_MEDIA_TYPES.includes(contentType)) {
                        res.status(400).send({ message: 'Invalid or missing contentType' });
                        return;
                    }

                    const result = await generateUploadUrl(user.id, contentType);
                    res.status(200).send(result);
                } catch (err: unknown) {
                    logger.error(err, 'Error in media/upload-url');
                    res.status(500).send();
                }
            }
        })(req, res, next);
    });
    app.post('/foxtrot-api/media/download-url', (req, res, next) => {
        passport.authenticate('jwt', async (err, user, info) => {
            if (err) {
                logAuthError(req, err);
                res.status(500).send();
            } else if (info) {
                logAuthRejected(req, info);
                res.status(403).send(info);
            } else {
                try {
                    const { objectKey } = req.body;
                    if (!objectKey || typeof objectKey !== 'string' || !objectKey.startsWith('media/')) {
                        res.status(400).send({ message: 'Invalid or missing objectKey' });
                        return;
                    }

                    const result = await generateDownloadUrl(objectKey);
                    res.status(200).send(result);
                } catch (err: unknown) {
                    logger.error(err, 'Error in media/download-url');
                    res.status(500).send();
                }
            }
        })(req, res, next);
    });

    // Metrics Route
    app.get('/foxtrot-api/metrics', expressBasicAuth({ users: { 'admin': ServerConfig.METRICS_PASSWORD }, challenge: true }), async (req, res) => {
        try {
            res.status(200).contentType('text/plain; version=0.0.4').send(await promClient.register.metrics());
        } catch (err) {
            logger.error(err, 'Metric endpoint error');
            res.status(401).send({ message: 'HTTP Basic Auth required' });
        }
    });
};

// Fetches the fcm_token for push notifications for the specified user from the database and caches it
export const getFCMToken = async (user_id: number) => {
    if (devices.has(user_id)) return devices.get(user_id);

    const res = await pool.query('SELECT fcm_token FROM users WHERE id = $1', [user_id]);
    const fcmToken = res.rows[0].fcm_token as string;
    devices.set(user_id, fcmToken);
    return fcmToken;
};

const generateTURNServerCredentials = (username: string) => {
    // Concat username with time so we rotate the secret over time
    const nowSeconds = Math.floor(Date.now() / 1000);
    const timedUsername = `${nowSeconds + ServerConfig.TURN_TTL}:${username}`;
    const hmac = createHmac('sha1', ServerConfig.TURN_SECRET)
        .update(timedUsername)
        .digest('base64');
    return { username: timedUsername, credential: hmac };
};
