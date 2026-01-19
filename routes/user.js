const express = require("express");
const router = express.Router();
const authenticateJWT = require("../middlewares/authenticateJWT")
const User = require("../models/User")
const Deployments = require("../models/Deployments")


router.get("/", authenticateJWT, async (req, res) => {
    const user = await User.findById(req.user.id);
    const deployments = await Deployments.find({ userId: req.user.id });
    res.json({
        "message": "success",
        user,
        deployments
    })
})

module.exports = router