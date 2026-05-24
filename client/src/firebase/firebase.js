import { initializeApp } from "firebase/app";

import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCKiQRj9awd8R7kitZOxGWBuF6pRHTPQvM",
  authDomain: "consul-ai-6b4ec.firebaseapp.com",
  projectId: "consul-ai-6b4ec",
  storageBucket: "consul-ai-6b4ec.firebasestorage.app",
  messagingSenderId: "796389487409",
  appId: "1:796389487409:web:6d6bbd88e5a90480fab610",
  measurementId: "G-V5Z5K7MD0X"
};

const app = initializeApp(firebaseConfig);

export const auth =
getAuth(app);