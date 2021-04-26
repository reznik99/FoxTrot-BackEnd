const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

module.exports = {
    secret: process.env.JWT_Secret,
};
