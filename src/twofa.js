// npm run 2fa: makes a new authenticator-app secret for the dashboard sign-in and says where to put it.
import crypto from "node:crypto";
import { hubFolder } from "./hub/settings.js";

const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const bytes = crypto.randomBytes(20);
let bits = "";
for (const b of bytes) bits += b.toString(2).padStart(8, "0");
const secret = bits.match(/.{5}/g).map((c) => A[parseInt(c, 2)]).join("");
const grouped = secret.match(/.{4}/g).join(" ");

console.log(`
New authenticator key for the dashboard sign-in:

    ${grouped}

1. In your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password...), add an account,
   choose "Enter a setup key", type the key above, name it "YT Pipeline", and pick "Time based".
2. Add this line to the .env file in ${hubFolder().replace(/\//g, "\\")}:

    DASHBOARD_TOTP_SECRET=${secret}

3. Restart the app. Every device is signed out once, and signing in now also asks for the 6-digit code.

To turn it off again, delete that line from .env and restart.
Keep the key private. Anyone with it and your password can sign in.
`);
