import {

sharedPrompt

}

from "./prompts/sharedPrompt.js";


import {

studyPrompt

}

from "./prompts/studyPrompt.js";


import {

interviewPrompt

}

from "./prompts/interviewPrompt.js";




export function getSystemPrompt(

phase,

mode,

language,

userData={}

){

const forcedLanguage=

language==="ru"

?

"Відповідай лише російською."

:

language==="pl"

?

"Odpowiadaj tylko po polsku."

:

"Відповідай лише українською.";



const modePrompt=

mode==="interview"

?

interviewPrompt

:

studyPrompt;



return `

${forcedLanguage}



${sharedPrompt}



${modePrompt}



Фаза:

${phase}



Дані користувача:

${JSON.stringify(

userData,

null,

2

)}

`;

}