const express = require("express");
const router = express.Router();
const authenticateJWT = require("../middlewares/authenticateJWT")
const User = require("../models/User")
const Deployments = require("../models/Deployments")


router.get("/", authenticateJWT, async (req, res) => {
    console.log("User", req.user);
    const user = await User.findById(req.user.id);
    console.log(req.user.id);
    console.log(typeof req.user.id)
    const deployments = await Deployments.find({userId:req.user.id});
    console.log(deployments);
    res.json({
        "message": "success",
        user,
        deployments
    })
})

module.exports = router