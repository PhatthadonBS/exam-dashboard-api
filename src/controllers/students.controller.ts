import {Router, Request, Response} from "express";
import { verifyToken } from "../middlewares/authen.middleware.js";
import { conn } from "../config/connect_db.js";
import { ResultSetHeader } from "mysql2/promise";

export const students = Router();

students.post("/", verifyToken, async (req: Request, res: Response) => {
    const body = req.body;
    let rawCodes: string[] = [];

    if (Array.isArray(body)) {
        rawCodes = body
        .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object" && "std_code" in item) {
                return String((item as { std_code: string }).std_code);
            }
            return "";
        })
        .map((code) => code.trim())
        .filter((code) => code.length > 0);
    } 

    if (rawCodes.length === 0) {
        return res.status(400).json({ message: "Payload must be a non-empty array or newline-separated string of student codes" });
    }

    const values = rawCodes.map((std_code) => {
        if (!/^\d{11}$/.test(std_code)) {
            throw new Error("Invalid student code");
        }
        return [std_code];
    });

try {
        const query = "INSERT IGNORE INTO students (std_code) VALUES ?"; 
        const [result] = await conn.query<ResultSetHeader>(query, [values]);
        
        res.status(201).json({
            insertedRows: result.affectedRows
        });
    } catch (error: any) {
        if (error?.code === "ER_DUP_ENTRY") {
            return res.status(400).json({ message: "Duplicate std_code found" });
        }
        res.status(500).json({ message: "Bulk insert failed", error: error?.message });
    }
}); 