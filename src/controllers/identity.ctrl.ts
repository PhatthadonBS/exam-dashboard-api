import { Router, Request, Response } from "express"

export const identity = Router();

identity.get("/", (req: Request, res: Response) => {
    res.send("Identity")
})