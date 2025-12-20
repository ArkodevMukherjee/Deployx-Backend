const mongoose = require("mongoose")

const RepositorySchema = new mongoose.Schema(
  {
    repoId: {
      type: Number,
      required: true
    },

    name: {
      type: String,
      required: true
    },

    fullName: {
      type: String,
      required: true
    },

    cloneUrl: {
      type: String,
      required: true
    }
  },
  {
    _id: false // IMPORTANT: do not create _id for each repo
  }
);



const InstallationSchema = new mongoose.Schema(
  {
    installationId: {
      type: Number,          // GitHub App installation ID
      required: true,
      unique: true,
      index: true
    },

    accountLogin: {
      type: String,          // GitHub username or org
      required: true
    },

    accountType: {
      type: String,          // User | Organization
      required: true
    },

    repositories: {
      type: [RepositorySchema],
      default: []
    },

    suspended: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Installation', InstallationSchema);