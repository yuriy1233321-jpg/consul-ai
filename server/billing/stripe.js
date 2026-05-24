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
"https://consul-ai-production-76b9.up.railway.app/success",

cancel_url:
"https://consul-ai-production-76b9.up.railway.app/cancel",

});


return session.url;

}