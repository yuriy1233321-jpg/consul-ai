import {
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";

import { auth }
from "../firebase/firebase";

const provider =
new GoogleAuthProvider();


async function syncUser(user){

  await fetch(
    `${import.meta.env.VITE_API_URL}/api/auth/firebase`,
    {
      method:"POST",
      headers:{
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        uid:user.uid,
        email:user.email,
        name:user.displayName
      })
    }
  );

}


export async function loginGoogle(){

  const result =
  await signInWithPopup(
    auth,
    provider
  );

  await syncUser(
    result.user
  );

  return result;

}


export async function registerEmail(
  email,
  password
){

  const result =
  await createUserWithEmailAndPassword(
    auth,
    email,
    password
  );

  await syncUser(
    result.user
  );

  return result;

}


export async function loginEmail(
  email,
  password
){

  const result =
  await signInWithEmailAndPassword(
    auth,
    email,
    password
  );

  await syncUser(
    result.user
  );

  return result;

}


export async function logout(){

  return await signOut(
    auth
  );

}