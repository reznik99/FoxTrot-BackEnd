
const express = require('express'),
    passport = require('passport'),
    bodyParser = require('body-parser'),
    createRoutes = require('./routes'),
    auth = require('./auth');

const PORT = process.env.PORT || 1234;
const app = express();

//middleware
app.use(bodyParser.json())
app.use(passport.initialize());

//authentication and routes
auth(passport);
createRoutes(app, passport);

//listen
app.listen(PORT, () => {
    console.info(`FoxTrot Server listening on ${PORT}`);
});
