import dotenv from "dotenv";

import OpenAI from "openai";


import {

getSystemPrompt

}

from "./prompts.js";


import {

normalizeLanguage

}

from "../services/languageService.js";


import {

normalizeAIResponse

}

from "../services/aiResponseService.js";



/*
====================
ENV
====================
*/

dotenv.config();



console.log(

process.env.OPENAI_API_KEY

?

"KEY OK"

:

"NO OPENAI KEY"

);




/*
====================
OPENAI
====================
*/

const openai=

new OpenAI({

apiKey:

process.env.OPENAI_API_KEY

});





export async function askAI(

message,

history=[],

language="uk",

mode="study",

phase="intro",

userData={}

){

try{




/*
====================
LANGUAGE
====================
*/

const lang=

normalizeLanguage(

language

);





/*
====================
PROMPT
====================
*/

const systemPrompt=

getSystemPrompt(

phase,

mode,

lang,

userData

);





/*
====================
MESSAGES
====================
*/

const messages=[

{

role:"system",

content:

systemPrompt

},



...(history||[]).map(

msg=>({

role:

msg.role==="assistant"

?

"assistant"

:

"user",



content:

msg.content

})

),



{

role:"user",

content:

message

}

];






/*
====================
OPENAI REQUEST
====================
*/

const response=

await openai.chat.completions.create({

model:

"gpt-4o-mini",


temperature:

0.5,


messages,


response_format:{

type:

"json_object"

}

});






const raw=

response

.choices[0]

.message

.content;



let parsed=null;





try{

parsed=

JSON.parse(

raw

);



console.log(

"AI JSON:",

parsed

);

}

catch{

console.log(

"RAW:",

raw

);

}






/*
====================
SAFE RESPONSE
====================
*/

const safe=

normalizeAIResponse(

parsed,

raw

);






/*
====================
RETURN
====================
*/

return safe;

}



catch(error){

console.error(

"AI ERROR:",

error.message

);



return{

type:

"evaluation",


content:

"Тимчасова помилка AI.",


metadata:{

score:null,

weakTopicsDetected:[]

}

};

}

}