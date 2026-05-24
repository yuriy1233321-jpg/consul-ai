import { useNavigate } from "react-router-dom";

function Auth() {

 const navigate = useNavigate();

 return (

<div
style={{
textAlign:"center",
marginTop:"100px"
}}
>

<h1>Login / Register</h1>

<button
onClick={() => navigate("/interview")}
>

Увійти

</button>

</div>

 )

}

export default Auth;