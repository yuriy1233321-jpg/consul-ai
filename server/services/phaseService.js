export function updatePhase(

user,
msg,
aiResponse,
helpers={}

){

const {

isValidName,
extractLevel,
CONFIRMATION_WORDS=[]

}=helpers;



switch(user.phase){

case "intro":

if(
isValidName(msg)
){

user.name=msg;
user.phase="onboarding";

}

break;



case "onboarding":{

const level =
extractLevel(msg);

if(level!==null){

user.level=level;
user.phase="diagnostic";

}

break;
}



case "diagnostic":

if(msg.length>2){

user.fears =
user.fears
?
user.fears+"\n"+msg
:
msg;

}

if(
aiResponse.metadata
?.weakTopicsDetected
){

user.weakTopics=[

...new Set([

...(user.weakTopics||[]),

...aiResponse.metadata
.weakTopicsDetected

])

];

}

user.phase="planning";

break;



case "planning":{

const confirmed=

CONFIRMATION_WORDS.some(

w=>

msg.toLowerCase()

.includes(w)

);

if(
confirmed
||
msg.length>20
||
user.planningAttempts>=2
){

user.phase=
"training";

}
else{

user.planningAttempts++;

}

break;
}

}

return user;

}