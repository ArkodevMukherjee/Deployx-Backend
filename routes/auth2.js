const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TempUser = require('../models/TempUser');
const User = require('../models/User');
const otpLimiter = require('../middlewares/otpLimiter');
const emailQueue = require('../queue/emailQueue');

const { connection } = require('../redis');

const router = express.Router();

router.post('/send-otp', otpLimiter, async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                message: 'Email is required'
            });
        }

        // Find existing temp user
        let tempUser = await TempUser.findOne({ email });

        // If not found, create a new temp user
        if (!tempUser) {
            tempUser = await TempUser.create({ email });
        }

        // Generate OTP
        const otp = Math.floor(
            100000 + Math.random() * 900000
        ).toString();

        tempUser.otp = crypto
            .createHash('sha256')
            .update(otp)
            .digest('hex');

        await tempUser.save();

        // Send OTP via email queue
        await emailQueue.add(
            'sendOtp',
            {
                to: email,
                otp
            },
            {
                attempts: 5,
                backoff: {
                    type: 'exponential',
                    delay: 1000
                }
            }
        );

        res.json({
            success: true,
            message: 'OTP sent to email.'
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            message: err.message
        });
    }
});


router.post('/verify-otp', async (req, res) => {
    try {
        const {
            email,
            otp,
            username,
            password
        } = req.body;

        if (!email || !otp || !username || !password) {
            return res.status(400).json({
                message:
                    'Email, OTP, username, and password are required'
            });
        }

        const otpHash = crypto
            .createHash('sha256')
            .update(otp)
            .digest('hex');

        const tempUser = await TempUser.findOne({
            email,
            otp: otpHash
        });

        if (!tempUser) {
            return res.status(401).json({
                message: 'Invalid or expired OTP'
            });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(
            password,
            10
        );

        const user = await User.create({
            username,
            email: tempUser.email,
            passwordHash,
            authProviders: ['local']
        });

        // Delete temp user
        await TempUser.deleteOne({
            _id: tempUser._id
        });

        const token = jwt.sign(
            {
                id: user._id,
                provider: 'local'
            },
            process.env.JWT_SECRET,
            {
                expiresIn: '1h'
            }
        );

        await emailQueue.add(
            'thankOtp',
            {
                to: email
            },
            {
                attempts: 5,
                backoff: {
                    type: 'exponential',
                    delay: 1000
                }
            }
        );

        res.json({
            message: 'Signup successful',
            token
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            message: err.message
        });
    }
});


// ======================================================
// LOGIN ROUTE
// ======================================================

router.post('/login', async (req, res) => {

    const requestStart = performance.now();

    try {

        const {
            email,
            password
        } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: 'Email and password required'
            });
        }


        // ------------------------------------------------
        // 1. MongoDB
        // ------------------------------------------------

        const mongoStart = performance.now();

        const user = await User.findOne({
            email
        });

        const mongoTime =
            performance.now() - mongoStart;


        if (!user) {
            return res.status(401).json({
                message: 'Invalid credentials'
            });
        }


        // ------------------------------------------------
        // 2. OAuth check
        // ------------------------------------------------

        if (!user.authProviders.includes('local')) {
            return res.status(403).json({
                message: 'Please login using OAuth provider'
            });
        }


        // ------------------------------------------------
        // 3. bcrypt
        // ------------------------------------------------

        const bcryptStart = performance.now();

        const isMatch = await bcrypt.compare(
            password,
            user.passwordHash
        );

        const bcryptTime =
            performance.now() - bcryptStart;


        if (!isMatch) {
            return res.status(401).json({
                message: 'Invalid credentials'
            });
        }


        // ------------------------------------------------
        // 4. JWT
        // ------------------------------------------------

        const jwtStart = performance.now();

        const token = jwt.sign(
            {
                id: user._id,
                provider: 'local'
            },
            process.env.JWT_SECRET,
            {
                expiresIn: '1h'
            }
        );

        const jwtTime =
            performance.now() - jwtStart;


        // ------------------------------------------------
        // 5. Total request time
        // ------------------------------------------------

        const totalTime =
            performance.now() - requestStart;


        // ------------------------------------------------
        // Diagnostic logging
        // ------------------------------------------------

        console.log(
            `[LOGIN] ` +
            `MongoDB: ${mongoTime.toFixed(2)} ms | ` +
            `bcrypt: ${bcryptTime.toFixed(2)} ms | ` +
            `JWT: ${jwtTime.toFixed(2)} ms | ` +
            `Total: ${totalTime.toFixed(2)} ms`
        );


        // ------------------------------------------------
        // Response
        // ------------------------------------------------

        res.json({
            message: 'Login successful',

            token,

            user: {
                id: user._id,
                username: user.username,
                email: user.email
            }
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            message: err.message
        });
    }
});


// ======================================================
// FORGOT PASSWORD - SEND OTP
// ======================================================

router.post('/forgot-password-otp', async (req, res) => {

    const { email } = req.body;

    if (!email) {
        return res.json({
            message: 'Email is needed to get the forgot password otp'
        });
    }

    const user = await User.findOne({
        email
    });

    if (!user) {
        return res.json({
            message: 'User does not exist need to login first'
        });
    }

    if (await connection.get(`${email}:forgot`)) {
        return res.json({
            message: 'OTP already sent to the email'
        });
    }

    const otp = Math.floor(
        100000 + Math.random() * 900000
    ).toString();

    const hashedOtp = await bcrypt.hash(
        otp,
        10
    );

    await connection.set(
        `${email}:forgot`,
        hashedOtp,
        'EX',
        300
    );

    await emailQueue.add(
        'sendOtp',
        {
            to: email,
            otp
        },
        {
            attempts: 5,
            backoff: {
                type: 'exponential',
                delay: 1000
            }
        }
    );

    return res.json({
        message: 'Otp has been queued in the backend'
    });
});


// ======================================================
// FORGOT PASSWORD - VERIFY OTP
// ======================================================

router.post('/forgot-password-verify', async (req, res) => {

    const {
        email,
        otp,
        password
    } = req.body;

    if (!email || !otp || !password) {
        return res.status(400).json({
            message: 'Missing email or otp or password'
        });
    }

    const otpRedis = await connection.get(
        `${email}:forgot`
    );

    if (!otpRedis) {
        return res.status(401).json({
            message: 'Otp does not exist'
        });
    }

    const isValid = await bcrypt.compare(
        otp,
        otpRedis
    );

    if (!isValid) {
        return res.status(401).json({
            message: 'Wrong otp try again'
        });
    }

    const user = await User.findOne({
        email
    });

    if (!user) {
        return res.status(400).json({
            message: 'User does not exist'
        });
    }

    user.passwordHash = await bcrypt.hash(
        password,
        10
    );

    await user.save();

    await connection.del(
        `${email}:forgot`
    );

    return res.status(200).json({
        success: true,
        message: 'Otp verified and password set up'
    });
});


module.exports = router;


