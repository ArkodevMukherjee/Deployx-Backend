// models/Deployment.js
const mongoose = require('mongoose');

const deploymentSchema = new mongoose.Schema({
  installationId: {
    type: Number,
    required: true
  },
  userId:{
    type:String
  },
  repoId: {
    type: Number,
    required: true
  },
  repoName: {
    type: String,
    required: true
  },
  fullName: {
    type: String,
    required: true
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