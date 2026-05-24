export function updateProgress(

user,

session,

score

){

/*
====================
INVALID SCORE
====================
*/

if(

typeof score !== "number"

)

return;



session.scores ||= [];



/*
====================
SAVE SCORE
====================
*/

session.scores.push(

score

);



session.averageScore=

session.scores.reduce(

(a,b)=>a+b,

0

)

/

session.scores.length;






/*
====================
XP
====================
*/

let earnedXP=0;



if(

score<=2

){

earnedXP=2;

}

else if(

score<=4

){

earnedXP=5;

}

else if(

score<=6

){

earnedXP=10;

}

else if(

score<=8

){

earnedXP=15;

}

else{

earnedXP=20;

}





user.xp=

(user.xp||0)

+

earnedXP;





/*
====================
TOTAL ANSWERS
====================
*/

user.totalAnswers=

(user.totalAnswers||0)

+

1;







/*
====================
RANK
====================
*/

if(

user.xp>=600

){

user.rank="Ready";

}

else if(

user.xp>=300

){

user.rank="Strong";

}

else if(

user.xp>=150

){

user.rank="Intermediate";

}

else if(

user.xp>=50

){

user.rank="Learner";

}

else{

user.rank="Beginner";

}

/*
====================
WEAK TOPICS WEIGHT
====================
*/

user.topicProgress ||= {};

user.weakTopics ||= [];



user.weakTopics.forEach(

topic=>{

if(

score<=5

){

user.topicProgress[topic]=

(

user.topicProgress[topic]

||

0

)

+

1;

}



else{

user.topicProgress[topic]=

Math.max(

0,

(

user.topicProgress[topic]

||

0

)

-

1

);

}

}

);

}