import { loginGoogle }
from "../services/auth";

export default function Login(){

const language =
localStorage.getItem("language")
|| "українська";


const text = {

українська: {
google:"Увійти через Google"
},

polski:{
google:"Zaloguj przez Google"
},

русский:{
google:"Войти через Google"
}

};


async function handleGoogle(){

try{

await loginGoogle();

alert("OK");

}

catch(err){

console.log(err);

}

}


return(

<div
style={{
display:"flex",
justifyContent:"center",
alignItems:"center",
height:"100vh"
}}
>

<button onClick={handleGoogle}>

{
text[language]?.google
||

text["українська"].google
}

</button>

</div>

);

}