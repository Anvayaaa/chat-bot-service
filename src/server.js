
import app from "./app.js";
import { env } from "./config/env.js";
import {connectDB} from "./config/db.js";

await connectDB();   //The sever only starts when the database is ready to take request.

app.listen(env.port, () => {
    console.log(`chat-bot-service running on http://localhost:${env.port}`);
})