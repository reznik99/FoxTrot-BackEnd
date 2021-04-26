
const express = require('express'),
    passport = require('passport'),
    createRoutes = require('./routes'),
    auth = require('./auth');

const PORT = process.env.PORT || 1234;
const app = express();

//middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

//authentication and routes
auth(passport);
createRoutes(app, passport);

//listen
app.listen(PORT, () => {
    console.info(`User-service listening on ${PORT}`);
});
