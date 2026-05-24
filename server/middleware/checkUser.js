import { User } from "../models/User.js";
import { Session } from "../models/Session.js";

export async function checkUser(req,res,next){

try{

console.log(
"CHECK USER START"
);

const deviceId =
req.headers["x-device-id"];


/*
====================

NO DEVICE

====================
*/

if(!deviceId){

console.log(
"NO DEVICE ID"
);

return res.status(401).json({

error:"No device id"

});

}



/*
====================

USER

====================
*/

let user =

await User.findOne({

deviceId

});


if(!user){

console.log(
"CREATING USER"
);


user =

await User.create({

deviceId,

premium:false,

phase:"intro",

freeQuestionsUsed:0,

lastResetAt:new Date(),

blockedAt:null,

name:null,

level:null,

fears:null,

weakTopics:[]

});

}



/*
====================

SESSION

====================
*/

let session =

await Session.findOne({

deviceId

});


if(!session){

console.log(
"NO SESSION"
);

console.log(
"CREATING SESSION..."
);


session =

await Session.create({

deviceId,

messages:[],

scores:[],

weakTopics:[],

lastTopic:null,

updatedAt:new Date()

});

}



/*
====================

RESET 24H

====================
*/

const passed =

(

Date.now()

-

new Date(

user.lastResetAt

)

)

/

1000/

60/

60;



if(

passed>=24

){

console.log(
"RESET LIMIT"
);


user.freeQuestionsUsed=0;

user.blockedAt=
null;

user.lastResetAt=
new Date();


if(

user.phase==="blocked"

){

user.phase=
"training";

}


await user.save();

}



/*
====================

PROTECTION

====================
*/

if(

user.freeQuestionsUsed==null

){

user.freeQuestionsUsed=0;

}


if(

!user.phase

){

user.phase=
"intro";

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

"SESSION:",

session._id

);



/*
====================

REQ

====================
*/

req.user =
user;

req.session =
session;


next();

}


catch(error){

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