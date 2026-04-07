import { Router, Request, Response } from "express"
import { verifyToken } from "../middlewares/authen.middleware.js";

export const users = Router();

users.get("/", verifyToken, (req: Request, res: Response) => {
    res.send("Users")
})