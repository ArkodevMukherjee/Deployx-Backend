// test-env.js
require("dotenv").config();
const path = require('path');

console.log("=== Debugging .env Loading ===");

// Show current working directory
console.log("Current directory:", process.cwd()); 
console.log("__dirname:", __dirname);

// Try to find .env file
const fs = require('fs');
const envPath = path.join(__dirname, '.env');
console.log("Looking for .env at:", envPath);
console.log(".env exists:", fs.existsSync(envPath));

if (fs.existsSync(envPath)) {
  console.log(".env content:");
  console.log(fs.readFileSync(envPath, 'utf8'));
}

// Show all loaded environment variables
console.log("\n=== Loaded Environment Variables ===");
console.log("GITHUB_APP_ID:", process.env.GITHUB_APP_ID);
console.log("PORT:", process.env.PORT);
console.log("MONGODB_URI:", process.env.MONGODB_URI);
console.log("AZURE_STORAGE_KEY:", process.env.AZURE_STORAGE_KEY);

// Show all env vars that start with GITHUB
console.log("\n=== GitHub Related Env Vars ===");
for (const key in process.env) {
  if (key.includes('GITHUB') || key.includes('APP')) {
    console.log(`${key}: ${process.env[key]}`);
  }
}