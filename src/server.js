
import app from "./app.js";
import { env } from "./config/env.js";


app.listen(env.port, () => {
    console.log(`chat-bot-service running on http://localhost:${env.port}`);
})