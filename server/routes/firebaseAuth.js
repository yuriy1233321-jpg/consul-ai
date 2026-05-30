import express from "express";
import crypto from "crypto";
import { User } from "../models/User.js";

const router = express.Router();

router.post("/", async (req, res) => {

  try {

    const {
      uid,
      email,
      name
    } = req.body;

    if (!uid) {
      return res.status(400).json({
        error: "Missing firebase uid"
      });
    }

    let user = await User.findOne({
      firebaseUid: uid
    });

    if (!user) {

      user = await User.create({

        firebaseUid: uid,

        deviceId: crypto.randomUUID(),

        email,

        name,

        premium: false,

        phase: "intro"

      });

    }

    return res.json({
      success: true,
      user
    });

  }

  catch (error) {

    console.error(error);

    return res.status(500).json({
      error: error.message
    });

  }

});

export default router;