import mongoose from "mongoose";


const userSchema = new mongoose.Schema(

{

/*
====================
IDENTITY
====================
*/

deviceId:{
  type:String,
  required:true,
  unique:true,
  index:true
},

firebaseUid:{
  type:String,
  unique:true,
  sparse:true,
  index:true
},


name:{

type:String,

default:null

},


email:{

type:String,

trim:true,

lowercase:true,

default:undefined,

index:{

unique:true,

sparse:true

}

},


passwordHash:{

type:String,

default:null

},




/*
====================
LEARNING
====================
*/

phase:{

type:String,

default:"intro"

},



language:{

type:String,

default:"українська"

},



level:{

type:Number,

default:null

},



fears:{

type:String,

default:""

},



weakTopics:{

type:[String],

default:[]

},




topicProgress:{

type:Object,

default:{}

},




learningHistory:{

type:[Object],

default:[]

},

/*
====================
INTERVIEW
====================
*/

lastInterview:{

readiness:{
type:Number,
default:0
},

score:{
type:Number,
default:0
},

strong:{
type:[String],
default:[]
},

weak:{
type:[String],
default:[]
},

repeatTopics:{
type:[String],
default:[]
},

summary:{
type:String,
default:""
},

mode:{
type:String,
default:null
},

date:{
type:Date,
default:null
}

},



interviewHistory:{

type:[Object],

default:[]

},



planningAttempts:{

type:Number,

default:0

},





/*
====================
PROGRESS
====================
*/

streak:{

type:Number,

default:0

},



lastStudyDate:{

type:Date,

default:null

},




xp:{

type:Number,

default:0

},



rank:{

type:String,

default:"Beginner"

},



totalAnswers:{

type:Number,

default:0

},



achievements:{

type:[String],

default:[]

},






/*
====================
LIMITS
====================
*/

freeQuestionsUsed:{

type:Number,

default:0

},



blockedAt:{

type:Date,

default:null

},



lastResetAt:{

type:Date,

default:Date.now

},






/*
====================
PREMIUM
====================
*/

premium:{

type:Boolean,

default:false

},



subscriptionType:{

type:String,

default:null

},



subscriptionExpiresAt:{

type:Date,

default:null

},






/*
====================
PAYMENT
====================
*/

stripeCustomerId:{

type:String,

default:null

},



stripeSubscriptionId:{

type:String,

default:null

}

},

{

timestamps:true

}

);




export const User =

mongoose.models.User

||

mongoose.model(

"User",

userSchema

);