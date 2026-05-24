import { useNavigate } from "react-router-dom";

function Landing() {

  const navigate = useNavigate();

  return (

    <div
      style={{
        textAlign:"center",
        marginTop:"80px"
      }}
    >

      <h1>🎯 CONSUL.AI</h1>

      <h2>
        AI-симулятор співбесіди
      </h2>

      <p>

        Аналіз →
        слабкі теми →
        готовність

      </p>

      <button
        onClick={() => navigate("/login")}
      >

        Почати

      </button>

    </div>

  );
}

export default Landing;