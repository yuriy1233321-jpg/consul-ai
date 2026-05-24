import {

GoogleAuthProvider,

signInWithPopup,

createUserWithEmailAndPassword,

signInWithEmailAndPassword,

signOut

}

from "firebase/auth";


import {

auth

}

from "../firebase/firebase";


const provider =
new GoogleAuthProvider();



export async function loginGoogle(){

return await signInWithPopup(
auth,
provider
);

}



export async function registerEmail(
email,
password
){

return await createUserWithEmailAndPassword(
auth,
email,
password
);

}



export async function loginEmail(
email,
password
){

return await signInWithEmailAndPassword(
auth,
email,
password
);

}



export async function logout(){

return await signOut(
auth
);

}