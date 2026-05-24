export function normalizeLanguage(language){

const lang =
(language || "")
.toLowerCase()
.trim();



if(

lang==="українська"

||

lang==="uk"

||

lang==="ua"

){

return "uk";

}



if(

lang==="polski"

||

lang==="pl"

||

lang==="polish"

){

return "pl";

}



if(

lang==="русский"

||

lang==="ru"

||

lang==="russian"

){

return "ru";

}



return "uk";

}