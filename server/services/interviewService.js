import { askAI }

from "../ai/client.js";



export async function saveInterview(

user,

session,

language,

phase

){

/*
====================
COUNT QUESTIONS
====================
*/

const assistantQuestions=

(session.messages||[])

.filter(

m=>

m.role==="assistant"

&&

m.content?.includes("?")

);



if(

assistantQuestions.length<5

){

return;

}



/*
====================
ALREADY SAVED
====================
*/

if(

user.lastInterview?.date

){

return;

}





/*
====================
SUMMARY PROMPT
====================
*/

const summaryPrompt=`

Проаналізуй співбесіду:

${JSON.stringify(

session.messages

)}

Поверни JSON:

{

"readiness":0,

"strong":[],

"weak":[],

"repeatTopics":[],

"summary":""

}

`;



const summary=

await askAI(

summaryPrompt,

[],

language,

"interview",

phase,

{}

);





try{

const parsed=

JSON.parse(

summary.content

);





const interviewResult={

readiness:

parsed.readiness||0,



score:

parsed.readiness||0,



strong:

parsed.strong||[],



weak:

parsed.weak||[],



repeatTopics:

parsed.repeatTopics||[],



summary:

parsed.summary||"",



mode:

"interview",



date:

new Date()

};






/*
====================
SAVE LAST
====================
*/

user.lastInterview=

interviewResult;






/*
====================
SAVE HISTORY
====================
*/

user.interviewHistory ||= [];



user.interviewHistory.push(

interviewResult

);



user.interviewHistory=

user.interviewHistory.slice(

-10

);





console.log(

"Interview saved"

);

}



catch(error){

console.log(

"Interview summary error:",

error.message

);

}

}