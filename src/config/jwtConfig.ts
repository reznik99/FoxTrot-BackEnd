import path from 'path';
require('dotenv').config({ path: path.join(__dirname, '.env') });

export const jwtSecret = process.env.JWT_Secret || ""
