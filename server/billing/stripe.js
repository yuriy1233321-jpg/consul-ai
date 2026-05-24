import Stripe from "stripe";

const stripe =
new Stripe(

process.env.STRIPE_SECRET_KEY

);


export async function createCheckout(){

const session =

await stripe.checkout.sessions.create({

payment_method_types:["card"],

mode:"subscription",

line_items:[{

price:
process.env.STRIPE_PRICE_ID,

quantity:1

}],


success_url:

"http://localhost:5173/success",


cancel_url:

"http://localhost:5173/cancel"

});


return session.url;

}