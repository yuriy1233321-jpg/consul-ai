import express from "express";

import { askAI }
from "../ai/client.js";

import { checkUser }
from "../middleware/checkUser.js";

import { updatePhase }
from "../services/phaseService.js";

import {
isBlocked,
incrementUsage,
resetLimit
}
from "../services/limitService.js";

import {
updateProgress
}
from "../services/progressService.js";

import {
updateAchievements
}
from "../services/achievementService.js";

import {
updateMemory
}
from "../services/memoryService.js";

import {
saveInterview
}
from "../services/interviewService.js";


const router =
express.Router();



const CONFIRMATION_WORDS=[

"так","готов","почнемо","ок","добре",

"tak","gotowy","zaczynamy",

"да","готов","начнем",

"yes"

];



function isValidName(text){

const msg=

text.trim()

.toLowerCase();



if(

msg.length<2

||

msg.length>25

)

return false;



const forbidden=[

"боюсь",
"не знаю",
"істор",
"культура",
"страх"

];



return !forbidden.some(

w=>msg.includes(w)

);

}



function extractLevel(msg){

const n=

parseInt(

msg.toLowerCase()

);



if(

!isNaN(n)

&&

n>=1

&&

n<=10

)

return n;



return null;

}




router.post(

"/",

checkUser,

async(req,res)=>{

try{


const {

message="",

language="українська",

mode="study"

}

=

req.body;



const user=
req.user;

const session=
req.session;



user.language=

language;

await user.save();

user.topicProgress||={};

user.learningHistory||=[];

user.achievements||=[];

session.scores||=[];

session.weakTopics||=[];

session.messages||=[];



if(

isBlocked(user)

){

let blockedMessage=

"Ліміт завершено. Повернись через 24 години або відкрий PRO.";



if(

user.language==="polski"

){

blockedMessage=

"Limit osiągnięty. Wróć za 24 godziny lub odblokuj PRO.";

}



if(

user.language==="русский"

){

blockedMessage=

"Лимит достигнут. Вернись через 24 часа или открой PRO.";

}



return res.status(403).json({

blocked:true,

message:

blockedMessage

});

}



const aiResponse=

await askAI(

message,

session.messages,

user.language,

mode,

user.phase,

{

name:user.name,

level:user.level,

fears:user.fears,

weakTopics:[

...(user.weakTopics||[]),

...(session.weakTopics||[])

]

}

);



updatePhase(

user,

message,

aiResponse,

{

isValidName,

extractLevel,

CONFIRMATION_WORDS

}

);



updateProgress(

user,

session,

aiResponse.metadata?.score

);



updateAchievements(

user,

session

);



resetLimit(

user

);


incrementUsage(

user,

aiResponse.type,

message

);



updateMemory(

session,

message,

aiResponse.content,

user

);



if(

mode==="interview"

&&

!user.lastInterview?.date

){

await saveInterview(

user,

session,

user.language,

user.phase

);

}



await session.save();

await user.save();



return res.json({

answer:

aiResponse.content,

type:

aiResponse.type,

remaining:

mode==="study"

?

Math.max(

0,

20-

(user.freeStudyUsed||0)

)

:

Math.max(

0,

10-

(user.freeInterviewUsed||0)

),

xp:

user.xp,

rank:

user.rank,

streak:

user.streak

});

}


catch(error){

console.log(error);

return res.status(500).json({

error:

"AI error",

details:

error.message

});

}

}

);



export default router;