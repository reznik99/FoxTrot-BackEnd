
const express = require('express'),
    session = require("express-session"),
    passport = require('passport'),
    bodyParser = require("body-parser"),
    createRoutes = require('./routes'),
    auth = require('./auth');

const PORT = process.env.PORT || 1234;
const app = express();

//middleware
app.use(session({
    secret: 'W$q4=25*8%v-}UV',
    resave: true,
    saveUninitialized: true
}));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(passport.initialize());
app.use(passport.session());

//authentication and routes
auth(passport);
createRoutes(app, passport);

//listen
app.listen(PORT, "0.0.0.0", () => {
    console.info(`User-service listening on ${PORT}`);
});