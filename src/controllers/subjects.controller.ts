import { Router, Request, Response } from "express";
import { conn } from "../config/connect_db.js";

export const subjects = Router();

subjects.get("/", async (req: Request, res: Response) => {
    const connection = await conn.getConnection();
    try {
        // ดึงเฉพาะวิชาที่เปิดสอน เรียงตามรหัสวิชา
        const [rows] = await connection.query(
            `SELECT subject_code, subject_name FROM subjects WHERE status = 'active' ORDER BY subject_code ASC`
        );
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error("Error fetching subjects:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลวิชา" });
    } finally {
        connection.release();
    }
});