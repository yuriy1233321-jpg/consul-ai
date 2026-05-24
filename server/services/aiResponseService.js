export function normalizeAIResponse(

parsed,

raw

){

const safe={

type:"evaluation",

content:"",

metadata:{

score:null,

weakTopicsDetected:[]

}

};



if(

!parsed

||

typeof parsed!=="object"

){

safe.content=

String(

raw ||

""

);

return safe;

}



const allowed=[

"greeting",

"onboarding",

"diagnostic_question",

"plan",

"training_question",

"evaluation",

"explanation",

"blocked_message"

];



safe.type=

allowed.includes(

parsed.type

)

?

parsed.type

:

"evaluation";



safe.content=

typeof parsed.content

==="string"

?

parsed.content

:

"Тимчасова помилка AI.";





if(

parsed.metadata

&&

typeof parsed.metadata

==="object"

){

safe.metadata.score=

typeof parsed.metadata.score

==="number"

?

parsed.metadata.score

:

null;



safe.metadata.weakTopicsDetected=

Array.isArray(

parsed.metadata

.weakTopicsDetected

)

?

parsed.metadata

.weakTopicsDetected

:

[];

}



return safe;

}