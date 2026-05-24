export function buildDashboard(user, session){

/*
====================
RECOMMENDATION
====================
*/

let recommendation="";


if((session.averageScore||0)<3){

recommendation=

"Почни з базових тем. 10–15 хв щодня та повтори слабкі місця.";

}

else if((session.averageScore||0)<6){

recommendation=

"Є прогрес. Повтори слабкі теми та тренуйся регулярно.";

}

else{

recommendation=

"Хороший рівень. Можна переходити до складніших питань.";

}





/*
====================
TODAY PLAN
====================
*/

let todayPlan=[];


const weakestTopics=

Object.entries(

user.topicProgress||{}

)

.sort(

(a,b)=>b[1]-a[1]

)

.slice(

0,

3

);



if(

weakestTopics.length

){

todayPlan.push(

`Повтори:
${weakestTopics[0][0]}`

);

}


todayPlan.push(

"Пройти 3 питання"

);

todayPlan.push(

"Отримати +30 XP"

);






/*
====================
NEXT RANK
====================
*/

let nextRank="Learner";

let nextXP=50;


if((user.xp||0)>=50){

nextRank="Intermediate";

nextXP=150;

}


if((user.xp||0)>=150){

nextRank="Strong";

nextXP=300;

}


if((user.xp||0)>=300){

nextRank="Ready";

nextXP=600;

}


if((user.xp||0)>=600){

nextRank="MAX";

nextXP=600;

}





/*
====================
WEEK REPORT
====================
*/

const weeklyReport={

streak:

user.streak||0,


xp:

user.xp||0,


rank:

user.rank||"Beginner",


average:

session.averageScore||0,

topics:

Object.entries(

user.topicProgress||{}

)

.sort(

(a,b)=>b[1]-a[1]

)

.slice(

0,

5
)

};






/*
====================
AI SUMMARY
====================
*/

let aiSummary="";


if((user.streak||0)>=3){

aiSummary+=

`🔥 Серія:
${user.streak}
днів. `;

}


if((session.averageScore||0)<3){

aiSummary+=

"Потрібно більше практики.";

}

else if((session.averageScore||0)<7){

aiSummary+=

"Є прогрес.";

}

else{

aiSummary+=

"Рівень росте швидко.";

}



if(

weakestTopics.length

){

aiSummary+=

` Найслабша тема:
${weakestTopics[0][0]}.`;

}



if(nextXP>(user.xp||0)){

aiSummary+=

` До нового рівня:
${nextXP-(user.xp||0)}
XP.`;

}





/*
====================
DAILY GOAL
====================
*/

let completed=0;


if((user.xp||0)>=30)
completed++;


if((session.scores||[]).length>=3)
completed++;


if(

Object.values(

user.topicProgress||{}

)

.some(

v=>Number(v)>=100

)

)

completed++;



const dailyGoal={

total:3,

completed

};






/*
====================
AI PREDICTION
====================
*/

const interviews=

user.interviewHistory

||

[];



const avgReadiness=

interviews.length

?

interviews.reduce(

(a,b)=>

a+

(

b.readiness||0

),

0

)

/

interviews.length

:

0;



let probability=20;

let risk="high";

let daysNeeded=14;



if(avgReadiness>=80){

probability=90;

risk="low";

daysNeeded=3;

}

else if(avgReadiness>=60){

probability=70;

risk="medium";

daysNeeded=7;

}

else if(avgReadiness>=40){

probability=50;

risk="medium";

daysNeeded=10;

}



const prediction={

probability,

risk,

daysNeeded

};






/*
====================
RETURN
====================
*/

return{

recommendation,

todayPlan,

nextRank,

nextXP,

weeklyReport,

aiSummary,

dailyGoal,

prediction

};

}