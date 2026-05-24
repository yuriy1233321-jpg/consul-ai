import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  loginGoogle,
  loginEmail,
  registerEmail
} from "../services/auth";

function Auth() {
  const navigate = useNavigate();

  const language =
    localStorage.getItem("language") ||
    "українська";

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [loading, setLoading] =
    useState(false);


  function text(ua, pl, ru) {
    if (language === "polski")
      return pl;

    if (language === "русский")
      return ru;

    return ua;
  }


  async function handleGoogle() {

    try {

      setLoading(true);

      await loginGoogle();

      navigate("/interview");

    } catch (err) {

      console.error(err);

      alert(
        text(
          "Помилка входу",
          "Błąd logowania",
          "Ошибка входа"
        )
      );

    } finally {

      setLoading(false);

    }

  }



  async function handleLogin() {

    try {

      setLoading(true);

      await loginEmail(
        email,
        password
      );

      navigate("/interview");

    } catch (err) {

      console.error(err);

      alert(
        text(
          "Невірний email або пароль",
          "Niepoprawny email lub hasło",
          "Неверный email или пароль"
        )
      );

    } finally {

      setLoading(false);

    }

  }



  async function handleRegister() {

    try {

      setLoading(true);

      await registerEmail(
        email,
        password
      );

      navigate("/interview");

    } catch (err) {

      console.error(err);

      alert(
        text(
          "Помилка реєстрації",
          "Błąd rejestracji",
          "Ошибка регистрации"
        )
      );

    } finally {

      setLoading(false);

    }

  }



  return (

    <div style={containerStyle}>

      <h1 style={{
        textAlign:"center"
      }}>
        CONSUL.AI
      </h1>


      <input
        required
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e)=>
          setEmail(
            e.target.value
          )
        }
        style={inputStyle}
      />


      <input
        required
        type="password"
        placeholder={
          text(
            "Пароль",
            "Hasło",
            "Пароль"
          )
        }
        value={password}
        onChange={(e)=>
          setPassword(
            e.target.value
          )
        }
        style={inputStyle}
      />


      <button
        onClick={handleLogin}
        disabled={loading}
        style={buttonStyle}
      >

        {
          loading
          ? "..."
          : text(
              "Увійти",
              "Zaloguj",
              "Войти"
            )
        }

      </button>



      <button
        onClick={handleRegister}
        disabled={loading}
        style={buttonStyle}
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
        disabled={loading}
        style={googleButton}
      >

        🔵 {

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



const containerStyle = {

  maxWidth:"420px",

  margin:"80px auto",

  padding:"40px",

  display:"flex",

  flexDirection:"column",

  gap:"16px",

  background:"#fff",

  borderRadius:"24px",

  boxShadow:
  "0 10px 30px rgba(0,0,0,.08)"

};



const inputStyle = {

  padding:"14px",

  borderRadius:"12px",

  border:"1px solid #ddd",

  fontSize:"16px"

};



const buttonStyle = {

  padding:"14px",

  border:"none",

  borderRadius:"12px",

  background:"#d62828",

  color:"#fff",

  fontWeight:"700",

  cursor:"pointer"

};



const googleButton = {

  ...buttonStyle,

  background:"#fff",

  color:"#111",

  border:"1px solid #ddd"

};



export default Auth;