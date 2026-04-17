import { Router, Request, Response } from "express";
import { conn } from "../config/connect_db.js"; 

export const subjects = Router();

// ดึงข้อมูลรายวิชาทั้งหมด พร้อมแยกคะแนนเก่า "ประมวลผล" กับ "ใบประกอบ" ออกจากกัน
subjects.get("/", async (req: Request, res: Response) => {
    const connection = await conn.getConnection();
    try {
        const sql = `
            SELECT 
                s.subject_code, 
                s.subject_name,
                -- 🌟 ดึงคะแนนล่าสุดเฉพาะรอบ "ประมวลผลความรู้" (round_type <= 2)
                COALESCE((
                    SELECT ec.full_score FROM exam_criteria ec 
                    JOIN exam_rounds er ON ec.round_id = er.round_id 
                    WHERE ec.subject_id = s.subject_id AND er.round_type <= 2 AND ec.full_score > 0 
                    ORDER BY ec.criteria_id DESC LIMIT 1
                ), 0) AS pre_full_score,
                
                COALESCE((
                    SELECT ec.passing_score FROM exam_criteria ec 
                    JOIN exam_rounds er ON ec.round_id = er.round_id 
                    WHERE ec.subject_id = s.subject_id AND er.round_type <= 2 AND ec.passing_score > 0 
                    ORDER BY ec.criteria_id DESC LIMIT 1
                ), 0) AS pre_passing_score,

                -- 🌟 ดึงคะแนนล่าสุดเฉพาะรอบ "ใบประกอบวิชาชีพ" (round_type >= 3)
                COALESCE((
                    SELECT ec.full_score FROM exam_criteria ec 
                    JOIN exam_rounds er ON ec.round_id = er.round_id 
                    WHERE ec.subject_id = s.subject_id AND er.round_type >= 3 AND ec.full_score > 0 
                    ORDER BY ec.criteria_id DESC LIMIT 1
                ), 0) AS lic_full_score,
                
                COALESCE((
                    SELECT ec.passing_score FROM exam_criteria ec 
                    JOIN exam_rounds er ON ec.round_id = er.round_id 
                    WHERE ec.subject_id = s.subject_id AND er.round_type >= 3 AND ec.passing_score > 0 
                    ORDER BY ec.criteria_id DESC LIMIT 1
                ), 0) AS lic_passing_score

            FROM subjects s 
            WHERE s.status = 1 
            ORDER BY s.subject_code ASC
        `;
        
        const [rows] = await connection.query(sql);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error("Error fetching subjects:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลวิชา" });
    } finally {
        connection.release();
    }
});