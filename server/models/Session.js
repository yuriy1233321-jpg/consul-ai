import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema({

/*
====================
DEVICE
====================
*/

deviceId:{
type:String,
required:true,
unique:true
},


/*
====================
CHAT HISTORY
====================
*/

messages:{

type:[{

role:String,

content:String

}],

default:[]

},


/*
====================
PROGRESS
====================
*/

scores:{
type:[Number],
default:[]
},


averageScore:{
type:Number,
default:0
},


weakTopics:{
type:[String],
default:[]
},


lastTopic:{
type:String,
default:null
}

},

{

timestamps:true

}

);


export const Session =

mongoose.models.Session ||

mongoose.model(

"Session",

sessionSchema

);