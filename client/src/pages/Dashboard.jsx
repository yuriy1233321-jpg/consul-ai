import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

function Dashboard() {

const navigate = useNavigate();

const [data,setData] =
useState(null);

const [language,setLanguage] =
useState(

localStorage.getItem("language")

||

"українська"

);



function text(ua,pl,ru){

if(language==="polski")
return pl;

if(language==="русский")
return ru;

return ua;

}



useEffect(()=>{

fetch(

"http://localhost:3000/api/dashboard",

{

headers:{

"x-device-id":

localStorage.getItem(

"deviceId"

)

}

}

)

.then(r=>r.json())

.then(setData)

.catch(console.error);

},[]);



if(!data){

return(

<div>

{text(

"Завантаження...",

"Ładowanie...",

"Загрузка..."

)}

</div>

);

}



const interviews =

data.interviewHistory

||

[];



const latest =
interviews.at(-1);


const previous =
interviews.at(-2);



const growth =

latest && previous

?

latest.readiness -

previous.readiness

:

0;



return(

<div style={{

maxWidth:"1200px",

margin:"30px auto",

padding:"20px"

}}>



{/* TOP */}

<div style={{

display:"flex",

justifyContent:

"space-between",

marginBottom:"30px"

}}>

<button

onClick={()=>

navigate("/interview")

}

>

🎭 {

text(

"Співбесіда",

"Rozmowa",

"Интервью"

)

}

</button>



<div>

<button onClick={()=>{

localStorage.setItem(

"language",

"українська"

);

setLanguage(

"українська"

);

}}>

UA

</button>



<button onClick={()=>{

localStorage.setItem(

"language",

"polski"

);

setLanguage(

"polski"

);

}}>

PL

</button>



<button onClick={()=>{

localStorage.setItem(

"language",

"русский"

);

setLanguage(

"русский"

);

}}>

RU

</button>

</div>

</div>



<h1>

{

text(

"Привіт 👋",

"Cześć 👋",

"Привет 👋"

)

}

</h1>



<p>

{

text(

"Твій прогрес",

"Twój postęp",

"Твой прогресс"

)

}

</p>



{/* SHORT TOP */}

<div className="grid">

<div className="card">

<h3>

⏳

{

text(

"Ліміт",

"Limit",

"Лимит"

)

}

</h3>

<h1>

{data.remaining}/5

</h1>

</div>



<div className="card">

<h3>

🎭

{

text(

"Остання оцінка",

"Ostatni wynik",

"Последняя оценка"

)

}

</h3>

<h1>

{

data.lastInterview

?.readiness

||

0

}

%

</h1>

</div>

</div>



{/* AI */}

<div className="card section">

<h2>

🧠 {

text(

"AI Аналіз",

"AI Analiza",

"AI Анализ"

)

}

</h2>

<p>

{

data.aiSummary

||

"—"

}

</p>

</div>



{/* PREDICTION */}

<div className="card section">

<h2>

🔮 {

text(

"AI Прогноз",

"AI Prognoza",

"AI Прогноз"

)

}

</h2>


<p>

Готовність:

{

data.prediction

?.probability

||

0

}%

</p>



<p>

{

data.prediction

?.probability>=80

?

"🟢"

:

data.prediction

?.probability>=60

?

"🟡"

:

"🔴"

}

</p>



<p>

{

text(

"Ризик",

"Ryzyko",

"Риск"

)

}

:

{

data.prediction?.risk==="high"

?

text(

"високий",

"wysokie",

"высокий"

)

:

data.prediction?.risk==="medium"

?

text(

"середній",

"średnie",

"средний"

)

:

text(

"низький",

"niskie",

"низкий"

)

}

</p>

</div>



{/* LAST INTERVIEW */}

<div className="card section">

<h2>

🎭 {

text(

"Остання співбесіда",

"Ostatnia rozmowa",

"Последнее интервью"

)

}

</h2>


<p>

{

text(

"Ще немає",

"Jeszcze brak",

"Пока нет"

)

}

</p>



{

data.lastInterview

?.weak

?.map(

t=>

<p key={t}>

❌ {t}

</p>

)

}



{

data.lastInterview

?.strong

?.map(

t=>

<p key={t}>

✅ {t}

</p>

)

}

</div>



{/* GROWTH */}

<div className="card section">

<h2>

📈 {

text(

"Прогрес готовності",

"Postęp gotowości",

"Прогресс готовности"

)

}

</h2>



{

latest

?

<>

<p>

Остання:

{latest.readiness}%

</p>


{

previous &&

<p>

Зміна:

{

growth>0

?

`+${growth}`

:

growth

}

%

</p>

}

</>

:

<p>

{

text(

"Ще мало співбесід",

"Za mało rozmów",

"Еще мало интервью"

)

}

</p>

}

</div>



{/* TOPICS */}

<div className="card section">

<h2>

🧠 {

text(

"Теми",

"Tematy",

"Темы"

)

}

</h2>



{

Object.keys(

data.topicProgress||{}

)

.length===0

?

<p>

{

text(

"Поки немає",

"Jeszcze brak",

"Пока нет"

)

}

</p>

:

Object.entries(

data.topicProgress

)

.map(

([topic,progress])=>

<div key={topic}>

<p>

{topic}

</p>


<progress

value={progress}

max="100"

/>

<p>

{progress}%

</p>

</div>

)

}

</div>



{/* HISTORY */}

<div className="card section">

<h2>

🎭 {

text(

"Історія співбесід",

"Historia rozmów",

"История интервью"

)

}

</h2>



{

(data.interviewHistory||[])

.length===0

?

<p>

Поки немає

</p>

:

data.interviewHistory

.slice()

.reverse()

.map(

(i,index)=>

<div key={index}>

<p>

{i.readiness}%

</p>

<p>

{i.summary}

</p>

<hr/>

</div>

)

}

</div>



</div>

);

}



export default Dashboard;