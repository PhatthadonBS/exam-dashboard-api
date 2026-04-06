import http from "http";           // 1: import http, dotenv
import dotenv from "dotenv";       
import { app } from "./app.js";    // 2: import application from app.ts

dotenv.config();                   // 3: read data from .env file and save to process.env 

const port = process.env.PORT || 3000; // 4: set port
const server = http.createServer(app); // 5: create server

server.listen(port, () => { // 6: start server
  console.log(`Server running on port http://localhost:${port}`);
});