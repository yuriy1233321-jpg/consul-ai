export function isBlocked(user){

return (

user.phase==="blocked"

&&

!user.premium

);

}




export function incrementUsage(

user,

type,

message=""

){

if(

user.premium

)

return;



/*
====================
IGNORE SPAM
====================
*/

const ignore=[

"ок",

"ага",

"далі",

"не знаю",

"що",

"?"

];



const msg=

message

.toLowerCase()

.trim();



if(

ignore.includes(

msg

)

){

return;

}



/*
====================
COUNTERS
====================
*/

user.freeStudyUsed ||= 0;

user.freeInterviewUsed ||= 0;



if(

type==="training_question"

){

user.freeStudyUsed +=1;

}



if(

type==="interview_question"

){

user.freeInterviewUsed +=1;

}



/*
====================
LIMITS
====================
*/

const studyLimit=

20;



const interviewLimit=

10;



if(

user.freeStudyUsed

>=

studyLimit

||

user.freeInterviewUsed

>=

interviewLimit

){

user.phase=

"blocked";



user.blockedAt=

new Date();

}

}




export function resetLimit(

user

){

const passed=

(

Date.now()

-

new Date(

user.lastResetAt

)

)

/

1000

/

60

/

60;



if(

passed>=24

){

user.freeStudyUsed=0;

user.freeInterviewUsed=0;



user.blockedAt=null;



user.lastResetAt=

new Date();



if(

user.phase==="blocked"

){

user.phase=

"training";

}

}

}