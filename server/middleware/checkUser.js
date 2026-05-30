import { User } from "../models/User.js";
import { Session } from "../models/Session.js";

export async function checkUser(req, res, next) {

  try {

    console.log("CHECK USER START");

    const firebaseUid =
      req.headers["x-firebase-uid"];

    if (!firebaseUid) {

      console.log("NO FIREBASE UID");

      return res.status(401).json({
        error: "No firebase uid"
      });

    }

    /*
    ====================
    USER
    ====================
    */

    let user = await User.findOne({
      firebaseUid
    });

    if (!user) {

      console.log(
        "USER NOT FOUND"
      );

      return res.status(401).json({
        error: "User not found in database"
      });

    }

    /*
    ====================
    SESSION
    ====================
    */

    let session =
      await Session.findOne({
        deviceId: firebaseUid
      });

    if (!session) {

      console.log(
        "CREATING SESSION"
      );

      session =
        await Session.create({

          deviceId: firebaseUid,

          messages: [],

          scores: [],

          weakTopics: [],

          lastTopic: null

        });

    }

    /*
    ====================
    RESET LIMIT
    ====================
    */

    const passed =

      (
        Date.now() -
        new Date(
          user.lastResetAt
        )
      )

      / 1000
      / 60
      / 60;

    if (passed >= 24) {

      user.freeQuestionsUsed = 0;

      user.blockedAt = null;

      user.lastResetAt =
        new Date();

      if (
        user.phase === "blocked"
      ) {

        user.phase =
          "training";

      }

      await user.save();

    }

    /*
    ====================
    PROTECTION
    ====================
    */

    if (
      user.freeQuestionsUsed == null
    ) {

      user.freeQuestionsUsed = 0;

    }

    if (!user.phase) {

      user.phase = "intro";

    }

    /*
    ====================
    DEBUG
    ====================
    */

    console.log(
      "USER:",
      user._id
    );

    console.log(
      "FIREBASE:",
      firebaseUid
    );

    console.log(
      "SESSION:",
      session._id
    );

    /*
    ====================
    REQ
    ====================
    */

    req.user = user;
    req.session = session;

    next();

  }

  catch (error) {

    console.error(
      "CHECK USER ERROR:",
      error
    );

    return res.status(500).json({

      error:
        "User middleware error",

      details:
        error.message

    });

  }

}