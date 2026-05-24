import express from "express";

import {

createCheckout

}

from "../billing/stripe.js";

import {

User

}

from "../models/User.js";

const router =
express.Router();



router.post(

"/checkout",

async(req,res)=>{

try{

const url =
await createCheckout();

res.json({url});

}

catch(error){

res.status(500).json({

error:error.message

});

}

}



/*
успішна оплата
*/

);



router.post(

"/success",

async(req,res)=>{

const {

deviceId

}

=

req.body;



await User.updateOne(

{

deviceId

},

{

premium:true,

phase:"training",

freeQuestionsUsed:0,

blockedAt:null,

subscriptionType:

"monthly",

subscriptionExpiresAt:

new Date(

Date.now()

+

30*24*60*60*1000

)

}

);



res.json({

success:true

});

}



);



export default router;