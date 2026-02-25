export const generatePaymobLink = async (amountInDollars: number, userEmail: string, userPhone: string, userName: string) => {
const apiKey = import.meta.env.VITE_PAYMOB_API_KEY;
const integrationId = import.meta.env.VITE_PAYMOB_INTEGRATION_ID;
const iframeId = import.meta.env.VITE_PAYMOB_IFRAME_ID;

const amountInCents = amountInDollars * 100 * 50;

try {
const authResponse = await fetch('', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ api_key: apiKey }),
});
const authData = await authResponse.json();
const token = authData.token;

} catch (error) {
console.error("PayMob Error:", error);
return null;
}
};
