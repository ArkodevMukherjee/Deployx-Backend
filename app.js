/**
 * @file app.js
 * @description Main entrypoint for DeployX Backend API server.
 * Sets up Express middleware, CORS policies, database connections, and routes.
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { connectToDb } = require('./connectToDb');

// Import Route Handlers
const authRouter = require('./routes/auth');
const oauthRouter = require('./routes/oauth');
const webhookRouter = require('./routes/webhook');
const deployRouter = require('./routes/deploy');
const userRouter = require('./routes/user');

const app = express();
const PORT = process.env.PORT || 8000;

// Trust reverse proxy (e.g., Nginx, ngrok, Cloudflare)
app.set('trust proxy', 1);

// Initialize MongoDB Connection
(async () => {
  await connectToDb();
})();

// Middleware: Body Parser with raw body preservation for GitHub Webhook HMAC verification
app.use(
  bodyParser.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);
app.use(bodyParser.urlencoded({ extended: true }));

// Middleware: Cross-Origin Resource Sharing (CORS)
const allowedOrigins = [
  'https://neurastack.xyz',
  'https://www.neurastack.xyz',
  'https://deployx-frontend.vercel.app',
  'https://frontend.neurastack.xyz',
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: [
    'https://neurastack.xyz',
    'https://www.neurastack.xyz',
    'https://deployx-frontend.vercel.app',
    'https://frontend.neurastack.xyz',
    'http://localhost:5173'
  ],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
}));

// app.use(
//   cors({
//     origin: (origin, callback) => {
//       // Allow requests with no origin (like mobile apps, curl, or Postman)
//       if (!origin || allowedOrigins.indexOf(origin) !== -1) {
//         callback(null, true);
//       } else {
//         callback(new Error(`Origin '${origin}' not allowed by CORS`));
//       }
//     },
//     credentials: true,
//     methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
//     allowedHeaders: ['Content-Type', 'Authorization', 'x-github-event', 'x-hub-signature-256']
//   })
// );

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root informational endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    service: 'DeployX Backend API',
    status: 'running',
    version: '1.0.0',
    documentation: '/docs'
  });
});

// Mount Routes
app.use('/auth', authRouter);
app.use('/auth/github', oauthRouter);
app.use('/webhook', webhookRouter);
app.use('/deploy', deployRouter);
app.use('/dashboard', userRouter);

// 404 Handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl} - Route not found`
  });
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]:', err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {})
  });
});

// Start Express Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[DeployX Server] Running on http://localhost:${PORT}`);
});

module.exports = app;