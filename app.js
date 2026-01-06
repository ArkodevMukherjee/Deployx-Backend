// app.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mongoose = require("mongoose");

const authRouter = require('./routes/auth');
const oauth = require('./routes/oauth');
const webhookRouter = require('./routes/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// DB
mongoose.connect('mongodb://127.0.0.1:27017/github-app')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

// ✅ MUST COME BEFORE /webhook
app.use(
  bodyParser.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);

app.use(cors({
  origin: "http://localhost:5173",
  credentials:true
}));




// Routes
app.use('/auth', authRouter);
app.use('/auth/github', oauth);
app.use('/webhook', webhookRouter); // ✅ now rawBody exists
app.use('/deploy', require("./routes/deploy"))
app.use('/dashboard', require("./routes/user"))

app.get('/', (req, res) => {
  res.json({ message: 'API is running' });
});

app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
