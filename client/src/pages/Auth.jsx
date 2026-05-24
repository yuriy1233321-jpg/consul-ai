import { useState } from "react";

import { useNavigate }
from "react-router-dom";

import {

loginGoogle,

loginEmail,

registerEmail

}

from "../services/auth";


function Auth(){

const navigate=
useNavigate();


const language=

localStorage.getItem(

"language"

)

||

"українська";


const [email,setEmail]=

useState("");

const [password,setPassword]=

useState("");



function text(

ua,

pl,

ru

){

if(

language==="polski"

)

return pl;


if(

language==="русский"

)

return ru;


return ua;

}



async function handleGoogle(){

try{

await loginGoogle();

navigate("/interview");

}

catch(err){

console.log(err);

alert("Login error");

}

}



async function handleLogin(){

try{

await loginEmail(

email,

password

);

navigate("/interview");

}

catch{

alert(

text(

"Помилка входу",

"Błąd logowania",

"Ошибка входа"

)

);

}

}



async function handleRegister(){

try{

await registerEmail(

email,

password

);

navigate("/interview");

}

catch{

alert(

text(

"Помилка реєстрації",

"Błąd rejestracji",

"Ошибка регистрации"

)

);

}

}



return(

<div
style={{

maxWidth:"420px",

margin:"100px auto",

display:"flex",

flexDirection:"column",

gap:"16px"

}}

>

<h1>

CONSUL.AI

</h1>


<input

placeholder=

"Email"

value={email}

onChange={e=>

setEmail(

e.target.value

)

}

/>


<input

type="password"

placeholder=

text(

"Пароль",

"Hasło",

"Пароль"

)

value={password}

onChange={e=>

setPassword(

e.target.value

)

}

/>


<button
onClick={handleLogin}
>

{

text(

"Увійти",

"Zaloguj",

"Войти"

)

}

</button>



<button
onClick={handleRegister}
>

{

text(

"Реєстрація",

"Rejestracja",

"Регистрация"

)

}

</button>



<button
onClick={handleGoogle}
>

{

text(

"Увійти через Google",

"Zaloguj przez Google",

"Войти через Google"

)

}

</button>


</div>

);

}


export default Auth;