export function updateAchievements(

user,
session

){

user.achievements ||= [];


if(

user.streak>=3

&&

!user.achievements.includes(

"3_days"

)

){

user.achievements.push(

"3_days"

);

}



if(

user.xp>=100

&&

!user.achievements.includes(

"100_xp"

)

){

user.achievements.push(

"100_xp"

);

}



if(

session.scores.length>=10

&&

!user.achievements.includes(

"10_answers"

)

){

user.achievements.push(

"10_answers"

);

}

}