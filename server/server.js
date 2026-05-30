
import dashboardRoute
from "./routes/dashboard.js";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { connectDB }
from "./config/db.js";

import chatRoute
from "./routes/chat.js";

import paymentRoute
from "./routes/payment.js";

import firebaseAuthRoute
from "./routes/firebaseAuth.js";

/*
========================
ENV
========================
*/

dotenv.config({

  path:"./server/.env"

});



console.log(

process.env.OPENAI_API_KEY

? "OpenAI loaded"

: "NO OPENAI KEY"

);



console.log(

process.env.MONGO_URI

? "Mongo URI loaded"

: "NO MONGO URI"

);



/*
========================
APP
========================
*/

const app =
express();



/*
========================
MIDDLEWARE
========================
*/

app.use(

cors({

origin:true,

credentials:true

})

);


app.use(
express.json()
);



/*
========================
HEALTH
========================
*/

app.get(

"/api/health",

(req,res)=>{

res.json({

status:"ok",

mongodb:true,

message:

"CONSUL.AI backend works"

});

}

);



/*
========================
ROUTES
========================
*/

app.use(

"/api/chat",

chatRoute

);

app.use(

"/api/dashboard",

dashboardRoute

);

app.use(
  "/api/auth/firebase",
  firebaseAuthRoute
);

/*
Stripe
*/

app.use(

"/api/payment",

paymentRoute

);



/*
========================
404
========================
*/

app.use(

(req,res)=>{

res.status(404).json({

error:
"Route not found"

});

}

);



/*
========================
GLOBAL ERROR
========================
*/

app.use(

(error,req,res,next)=>{

console.error(

"SERVER ERROR:",

error

);


res.status(500).json({

error:
"Internal server error"

});

}

);



/*
========================
PORT
========================
*/

const PORT =

process.env.PORT

||

3000;



/*
========================
START
========================
*/

async function startServer(){

try{

console.log(

"Connecting Mongo..."

);


await connectDB();


console.log(

"MongoDB connected"

);



app.listen(

PORT,

()=>{

console.log(

"==================="

);

console.log(

`Server running:
http://localhost:${PORT}`

);

console.log(

"==================="

);

}

);


}

catch(error){

console.error(

"START ERROR:",

error.message

);

process.exit(1);

}

}



startServer();