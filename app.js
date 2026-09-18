// app.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { connectToDb } = require("./connectToDb")

const authRouter = require('./routes/auth2');
const oauth = require('./routes/oauth');
const webhookRouter = require('./routes/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

// DB
(async () => {
  await connectToDb();
})();



// MUST COME BEFORE /webhook
app.use(
  bodyParser.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);

app.use(cors({
  origin: [
    'https://neurastack.xyz',
    'https://www.neurastack.xyz',
    'https://deployx-frontend.vercel.app',
    'https://frontend.neurastack.xyz',
    'http://localhost:5173'
  ],
  credentials: true
}));


// Routes
app.use('/auth', authRouter);
app.use('/auth/github', oauth);
app.use('/webhook', webhookRouter); // now rawBody exists
app.use('/deploy', require("./routes/deploy2"))
app.use('/dashboard', require("./routes/user"))

app.get('/', (req, res) => {
  res.json({ message: 'API is running' });
});

app.listen(PORT, '0.0.0.0', () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
