const mongoose = require("mongoose");

const connectToDb = async () => {
    try {
        await mongoose.connect(`${process.env.MONGO_URI}/github-app`);
        console.log("MongoDB connected");
    }
    catch (err) {
        console.error(err);
    }
}

module.exports = { connectToDb }