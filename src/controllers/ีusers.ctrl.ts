import { Router, Request, Response } from "express"

export const users = Router();

users.get("/", (req: Request, res: Response) => {
    res.send("Users")
})