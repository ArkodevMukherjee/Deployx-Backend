// models/Deployment.js
const mongoose = require('mongoose');

const deploymentSchema = new mongoose.Schema({
  installationId: {
    type: Number
  },
  userId:{
    type:String
  },
  repoId: {
    type: Number
  },
  repoName: {
    type: String
  },
  fullName: {
    type: String
  },
  branchName: {
    type: String,
    default: 'main'
  },
  environment: {
    type: String,
    default: 'production'
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'success', 'failed', 'removed','queued'],
    default: 'pending'
  },

  deploypath:{
    type:String,
  },
  deployedUrl:{
    type:String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  logs: {
    type: String, // optional, store deployment logs if needed
    default: ''
  }
}, {
  timestamps: true // adds createdAt and updatedAt automatically
});

module.exports = mongoose.model('Deployment', deploymentSchema);