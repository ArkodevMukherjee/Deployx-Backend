const mongoose = require('mongoose');

const RepositorySchema = new mongoose.Schema(
  {
    repoId: {
      type: Number,          // GitHub repository ID
      required: true
    },
    name: {
      type: String,          // repo name
      required: true
    },
    fullName: {
      type: String,          // owner/repo
      required: true
    },
    cloneUrl: {
      type: String,          // https clone url
      required: true
    },
    defaultBranch: {
      type: String,
      default: 'main'
    }
  },
  { _id: false }
);

module.exports = mongoose.model("Repository",RepositorySchema)