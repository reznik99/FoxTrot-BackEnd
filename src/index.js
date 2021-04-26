
const express = require('express'),
    passport = require('passport'),
    bodyParser = require('body-parser'),
    multer = require('multer'),
    createRoutes = require('./routes'),
    auth = require('./auth');

const PORT = process.env.PORT || 1234;
const app = express();

//middleware
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(multer())
app.use(passport.initialize());

//authentication and routes
auth(passport);
createRoutes(app, passport);

//listen
app.listen(PORT, () => {
    console.info(`User-service listening on ${PORT}`);
});
