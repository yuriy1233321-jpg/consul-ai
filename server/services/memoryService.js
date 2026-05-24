export function updateMemory(

session,
message,
answer,
user=null

){

session.messages ||= [];

session.messages.push(

{

role:"user",

content:

String(message)

.slice(

0,

300

)

},

{

role:"assistant",

content:

String(answer)

.slice(

0,

500

)

}

);



const LIMIT=20;



session.messages=

session.messages.slice(

-LIMIT

);



/*
====================
WEAK TOPICS
====================
*/

if(

user

){

user.weakTopics ||= [];

user.topicProgress ||= {};



const topics=[

"Мешко",

"Мешко I",

"Конституція",

"Поділи Польщі",

"історія",

"культура",

"географія",

"Карта Поляка"

];



topics.forEach(

topic=>{

const msg=

String(message)

.toLowerCase();



const ans=

String(answer)

.toLowerCase();



if(

msg.includes(

topic.toLowerCase()

)

||

ans.includes(

topic.toLowerCase()

)

){

if(

!user.weakTopics.includes(

topic

)

){

user.weakTopics.push(

topic

);

}



user.topicProgress[topic]=

(

user.topicProgress[topic]

||

0

)

+

1;

}

}

);

}

}