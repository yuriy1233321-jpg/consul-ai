
import axios from "axios";

export const sendMessage = (message) =>
  axios.post("/chat", { message });
