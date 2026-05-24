import express from "express";

import {

checkUser

}

from "../middleware/checkUser.js";


import {

buildDashboard

}

from "../services/dashboardService.js";


const router=

express.Router();



router.get(

"/",

checkUser,

async(req,res)=>{

try{


const user=

req.user;


const session=

req.session;



const dashboard=

buildDashboard(

user,

session

);




return res.json({



averageScore:

session.averageScore||0,



scores:

session.scores||[],



weakTopics:

session.weakTopics||[],



topicProgress:

user.topicProgress||{},



learningHistory:

user.learningHistory||[],



lastInterview:

user.lastInterview||{},



interviewHistory:

user.interviewHistory||[],



lastTopic:

session.lastTopic||null,



streak:

user.streak||0,



xp:

user.xp||0,



rank:

user.rank||"Beginner",



achievements:

user.achievements||[],



used:

user.freeQuestionsUsed||0,



remaining:

Math.max(

0,

5-

(

user.freeQuestionsUsed||0

)

),



premium:

user.premium||false,



phase:

user.phase||"intro",



...dashboard



});

}



catch(error){

return res.status(500).json({

error:

"Dashboard error",

details:

error.message

});

}

}

);



export default router;