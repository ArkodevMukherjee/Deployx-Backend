const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: String,
  email: { type: String, unique: true,sparse:true},
  passwordHash: String,
  githubId: String,
  authProviders: [String], // 'local' | 'github'
  role:{
    type:String,
    enum:['recruiter','user'],
    default:'user'
  },
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);