export function countQuestion(

user,
type

){

const countable=[

"training_question",

"evaluation"

];


if(

countable.includes(type)

){

user.freeQuestionsUsed++;

}

}