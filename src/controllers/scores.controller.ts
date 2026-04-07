import { Router, Request, Response } from 'express';
import { conn } from '../config/connect_db.js';

export const scores = Router();

// ========================================================
// 1. API นำเข้าคะแนน (POST /scores/import)
// ========================================================
scores.post('/import', async (req: Request, res: Response): Promise<void> => {
    const { round_id, scores_data } = req.body;

    if (!round_id || !scores_data || scores_data.length === 0) {
        res.status(400).json({ success: false, message: "ข้อมูลไม่ครบถ้วน กรุณาระบุรอบการสอบและคะแนน" });
        return;
    }

    const connection = await conn.getConnection();

    try {
        await connection.beginTransaction();

        // 1. ดึงวิชามาทำ Map เพื่อแปลง Code เป็น ID
        const [subjects] = await connection.query<any[]>('SELECT subject_id, subject_code FROM subjects');
        const subjectMap = subjects.reduce((acc, row) => {
            acc[row.subject_code] = row.subject_id;
            return acc;
        }, {} as Record<string, number>);

        // 2. ดึงนักศึกษาที่มีอยู่แล้วมาทำ Map
        const [students] = await connection.query<any[]>('SELECT std_id, std_code FROM students');
        const studentMap = students.reduce((acc, row) => {
            acc[row.std_code] = row.std_id;
            return acc;
        }, {} as Record<string, number>);

        const valuesToInsert: any[][] = [];

        // 3. วนลูปเตรียมข้อมูล
        for (const student of scores_data) {
            let std_id = studentMap[student.std_code];

            // ✨ ท่าไม้ตาย: ถ้าเป็นเด็กใหม่ที่ยังไม่มีใน DB ให้เพิ่มอัตโนมัติ!
            if (!std_id) {
                const [insertStd] = await connection.query<any>(
                    `INSERT INTO students (std_code, status) VALUES (?, 1)`, [student.std_code]
                );
                std_id = insertStd.insertId;
                studentMap[student.std_code] = std_id; // อัปเดต Map เผื่อมีคิวรี่ซ้ำ
            }

            // เตรียมคะแนนแต่ละวิชาเพื่อทำ Bulk Insert
            for (const sub of student.subjects) {
                const subject_id = subjectMap[sub.subject_code];
                if (subject_id && sub.score !== null && sub.score !== undefined) {
                    // 📌 เอา user_id ออกไปแล้ว เพื่อให้ตรงกับ DB ของคุณ
                    valuesToInsert.push([sub.score, std_id, subject_id, round_id]);
                }
            }
        }

        if (valuesToInsert.length === 0) {
             res.status(400).json({ success: false, message: "ไม่พบข้อมูลคะแนนหรือรายวิชาในระบบ" });
             return;
        }

        // 4. บันทึกข้อมูลรวดเดียว (ทำงานเร็วกว่าลูปทีละครั้ง)
        const sql = `
            INSERT INTO exam_scores (score, std_id, subject_id, round_id) 
            VALUES ?
            ON DUPLICATE KEY UPDATE 
            score = VALUES(score)
        `;

        await connection.query(sql, [valuesToInsert]);
        await connection.commit();
        
        res.status(200).json({ 
            success: true,
            message: "บันทึกคะแนนสำเร็จ", 
            records_processed: valuesToInsert.length 
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error importing scores:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกคะแนนเซิร์ฟเวอร์", error });
    } finally {
        connection.release();
    }
});

// ========================================================
// 2. API ดึงคะแนนรายรอบสอบ (GET /scores/:round_id)
// ========================================================
scores.get('/:round_id', async (req: Request, res: Response): Promise<void> => {
    const round_id = req.params.round_id;
    const connection = await conn.getConnection();

    try {
        const sql = `
            SELECT 
                st.std_code,
                su.subject_code,
                su.subject_name,
                es.score
            FROM exam_scores es
            JOIN students st ON es.std_id = st.std_id
            JOIN subjects su ON es.subject_id = su.subject_id
            WHERE es.round_id = ?
            ORDER BY st.std_code ASC, su.subject_code ASC
        `;
        
        const [rows] = await connection.query<any[]>(sql, [round_id]);

        // จัดกลุ่มข้อมูลให้เป็นแนวนอน
        const studentScoresMap: Record<string, any> = {};

        for (const row of rows) {
            if (!studentScoresMap[row.std_code]) {
                studentScoresMap[row.std_code] = {
                    std_code: row.std_code,
                    scores: {} 
                };
            }
            studentScoresMap[row.std_code].scores[row.subject_code] = row.score;
        }

        const result = Object.values(studentScoresMap);

        res.status(200).json({ 
            success: true, 
            data: result 
        });

    } catch (error) {
        console.error("Error fetching scores:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลคะแนน", error });
    } finally {
        connection.release();
    }
});