import mongoose from "mongoose";

const paymentSchema =
new mongoose.Schema({

deviceId:String,

stripeId:String,

status:String,

amount:Number,

createdAt:{
type:Date,
default:Date.now
}

});

export const Payment =
mongoose.models.Payment ||
mongoose.model(
"Payment",
paymentSchema
);