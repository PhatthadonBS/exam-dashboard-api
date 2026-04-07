import { Router, Request, Response } from "express"
import { verifyToken } from "../middlewares/authen.middleware.js";
import { conn } from "../config/connect_db.js";

export const users = Router();

users.get("/", verifyToken, async (req: Request, res: Response) => {
    const [users] = await conn.query("SELECT * FROM users");
    res.json(users);
})