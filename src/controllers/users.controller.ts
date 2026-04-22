import { Router, Request, Response } from "express"
import { verifyToken } from "../middlewares/authen.middleware.js";
import { conn } from "../config/connect_db.js";
import { get } from "node:http";
import { getUser } from "../utils/users.utils.js";
import { ResultSetHeader } from "mysql2";

export const users = Router();

users.get("/", async (req: Request, res: Response) => {
    const [users] = await conn.query("SELECT * FROM users");
    res.json(users);
})

users.get("/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    const [user] = await getUser(Number(id), null);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
})



