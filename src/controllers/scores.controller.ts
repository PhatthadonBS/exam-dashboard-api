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

        // 🌟 1. เช็คว่าเป็นสอบประมวลผล หรือ สอบใบประกอบวิชาชีพ
        const [roundInfo] = await connection.query<any[]>('SELECT round_type FROM exam_rounds WHERE round_id = ?', [round_id]);
        const roundType = roundInfo[0]?.round_type;
        const isLicense = roundType >= 3; // ถ้า >= 3 คือสอบใบประกอบวิชาชีพ

        // 2. ดึงวิชามาทำ Map เพื่อแปลง Code เป็น ID
        const [subjects] = await connection.query<any[]>('SELECT subject_id, subject_code FROM subjects');
        const subjectMap = subjects.reduce((acc, row) => {
            acc[row.subject_code] = row.subject_id;
            return acc;
        }, {} as Record<string, number>);

        // 3. ดึงนักศึกษาที่มีอยู่แล้วมาทำ Map
        const [students] = await connection.query<any[]>('SELECT std_id, std_code FROM students');
        const studentMap = students.reduce((acc, row) => {
            acc[row.std_code] = row.std_id;
            return acc;
        }, {} as Record<string, number>);

        const valuesToInsert: any[][] = [];

        // 4. วนลูปเตรียมข้อมูล
        for (const student of scores_data) {
            let std_id = studentMap[student.std_code];

            if (!std_id) {
                const [insertStd] = await connection.query<any>(
                    `INSERT INTO students (std_code, status) VALUES (?, 1)`, [student.std_code]
                );
                std_id = insertStd.insertId;
                studentMap[student.std_code] = std_id; 
            }

            if (isLicense) {
                // 🎓 โหมดใบประกอบวิชาชีพ (เก็บลง exam_paper_result)
                // แปลงคะแนน 1 = 3 (Pass), 0 = 2 (Fail)
                const passScore = student.subjects[0]?.score; 
                if (passScore !== null && passScore !== undefined) {
                    const paper_result = passScore === 1 ? 3 : 2; 
                    valuesToInsert.push([std_id, round_id, paper_result]);
                }
            } else {
                // 📝 โหมดประมวลผลความรู้ (เก็บลง exam_scores)
                for (const sub of student.subjects) {
                    const subject_id = subjectMap[sub.subject_code];
                    if (subject_id && sub.score !== null && sub.score !== undefined) {
                        valuesToInsert.push([sub.score, std_id, subject_id, round_id]);
                    }
                }
            }
        }

        if (valuesToInsert.length === 0) {
             res.status(400).json({ success: false, message: "ไม่พบข้อมูลคะแนนหรือรายวิชาในระบบ" });
             return;
        }

        // 5. บันทึกข้อมูลรวดเดียว แยกตามตาราง
        if (isLicense) {
            // โยนเข้าตาราง exam_paper_result
            const sql = `
                INSERT INTO exam_paper_result (std_id, round_id, paper_result) 
                VALUES ?
                ON DUPLICATE KEY UPDATE 
                paper_result = VALUES(paper_result)
            `;
            await connection.query(sql, [valuesToInsert]);
        } else {
            // โยนเข้าตาราง exam_scores (เหมือนเดิม)
            const sql = `
                INSERT INTO exam_scores (score, std_id, subject_id, round_id) 
                VALUES ?
                ON DUPLICATE KEY UPDATE 
                score = VALUES(score)
            `;
            await connection.query(sql, [valuesToInsert]);
        }

        await connection.commit();
        res.status(200).json({ success: true, message: "บันทึกคะแนนสำเร็จ", records_processed: valuesToInsert.length });

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
        const [roundInfo] = await connection.query<any[]>('SELECT round_type FROM exam_rounds WHERE round_id = ?', [round_id]);
        const roundType = roundInfo[0]?.round_type;

        if (roundType >= 3) {
            // 🎓 ดึงข้อมูลใบประกอบจาก exam_paper_result
            const sql = `
                SELECT st.std_code, epr.paper_result
                FROM exam_paper_result epr
                JOIN students st ON epr.std_id = st.std_id
                WHERE epr.round_id = ?
            `;
            const [rows] = await connection.query<any[]>(sql, [round_id]);

            // ไปดึงรหัสวิชาของรอบนี้ เพื่อส่งให้หน้าบ้านโชว์ถูกช่อง
            const [crit] = await connection.query<any[]>(`
                SELECT su.subject_code FROM exam_criteria ec 
                JOIN subjects su ON ec.subject_id = su.subject_id 
                WHERE ec.round_id = ? LIMIT 1
            `, [round_id]);
            const subject_code = crit[0]?.subject_code || 'LICENSE';

            // ส่งข้อมูลกลับไปแบบเนียนๆ (แปลง 3 เป็น 1(ผ่าน), 2 เป็น 0(ตก))
            const result = rows.map(r => ({
                std_code: r.std_code,
                scores: { [subject_code]: r.paper_result === 3 ? 1 : 0 }
            }));
            
            res.status(200).json({ success: true, data: result });

        } else {
            // 📝 ดึงข้อมูลประมวลผลจาก exam_scores (เหมือนเดิม)
            const sql = `
                SELECT st.std_code, su.subject_code, es.score
                FROM exam_scores es
                JOIN students st ON es.std_id = st.std_id
                JOIN subjects su ON es.subject_id = su.subject_id
                WHERE es.round_id = ?
            `;
            const [rows] = await connection.query<any[]>(sql, [round_id]);
            const studentScoresMap: Record<string, any> = {};

            for (const row of rows) {
                if (!studentScoresMap[row.std_code]) {
                    studentScoresMap[row.std_code] = { std_code: row.std_code, scores: {} };
                }
                studentScoresMap[row.std_code].scores[row.subject_code] = row.score;
            }

            res.status(200).json({ success: true, data: Object.values(studentScoresMap) });
        }

    } catch (error) {
        console.error("Error fetching scores:", error);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลคะแนน", error });
    } finally {
        connection.release();
    }
});

// ========================================================
// 3. API ดึงสรุปผลแบบ Matrix (GET /scores/summary/:year)
// ========================================================
scores.get('/summary/:year', async (req: Request, res: Response): Promise<void> => {
    const year = req.params.year;
    const connection = await conn.getConnection();

    try {
        // 1. ดึงรอบสอบทั้งหมดในปีนั้น
        const [rounds] = await connection.query<any[]>(
            `SELECT round_id, round_type FROM exam_rounds WHERE academic_year = ? ORDER BY round_type ASC`, [year]
        );

        if (rounds.length === 0) {
             res.status(200).json({ success: true, data: [] });
             return;
        }

        const preRoundIds = rounds.filter(r => r.round_type <= 2).map(r => r.round_id);
        const licRoundIds = rounds.filter(r => r.round_type >= 3).map(r => r.round_id);

        const studentMap: any = {};
        const initStudent = (std_code: string) => {
            if (!studentMap[std_code]) {
                studentMap[std_code] = { id: std_code, year: Number(year), rounds: {} };
            }
        };

        // 📝 2. ดึงข้อมูลสอบ "ประมวลผลความรู้" (จากตาราง exam_scores)
        if (preRoundIds.length > 0) {
            const [criteria] = await connection.query<any[]>(
                `SELECT round_id, subject_id, passing_score FROM exam_criteria WHERE round_id IN (?)`, [preRoundIds]
            );
            const criteriaMap: any = {};
            criteria.forEach(c => {
                if (!criteriaMap[c.round_id]) criteriaMap[c.round_id] = {};
                criteriaMap[c.round_id][c.subject_id] = Number(c.passing_score);
            });

            const [scoresData] = await connection.query<any[]>(`
                SELECT s.std_code, es.round_id, es.subject_id, es.score
                FROM exam_scores es
                JOIN students s ON es.std_id = s.std_id
                WHERE es.round_id IN (?)
            `, [preRoundIds]);

            const preScoresMap: any = {};
            scoresData.forEach(row => {
                initStudent(row.std_code);
                if (!preScoresMap[row.std_code]) preScoresMap[row.std_code] = {};
                if (!preScoresMap[row.std_code][row.round_id]) preScoresMap[row.std_code][row.round_id] = {};
                preScoresMap[row.std_code][row.round_id][row.subject_id] = Number(row.score);
            });

            Object.keys(preScoresMap).forEach(std_code => {
                preRoundIds.forEach(r_id => {
                    const r_type = rounds.find(r => r.round_id === r_id).round_type;
                    const roundData = preScoresMap[std_code][r_id];
                    
                    if (roundData) {
                        let failCount = 0;
                        let subjectCount = 0;
                        const roundCriteria = criteriaMap[r_id] || {};
                        
                        Object.keys(roundCriteria).forEach(subId => {
                            subjectCount++;
                            const passScore = roundCriteria[subId];
                            const actualScore = roundData[subId] || 0;
                            if (actualScore < passScore) failCount++;
                        });

                        if (failCount === 0 && subjectCount > 0) {
                            studentMap[std_code].rounds[r_type] = { status: 'pass', detail: `ผ่านครบ ${subjectCount} วิชา` };
                        } else {
                            studentMap[std_code].rounds[r_type] = { status: 'fail', detail: `ตก ${failCount} วิชา` };
                        }
                    }
                });
            });
        }

        // 🎓 3. ดึงข้อมูลสอบ "ใบประกอบวิชาชีพ" (จากตาราง exam_paper_result 🌟 ของใหม่)
        if (licRoundIds.length > 0) {
            const [licData] = await connection.query<any[]>(`
                SELECT s.std_code, epr.round_id, epr.paper_result
                FROM exam_paper_result epr
                JOIN students s ON epr.std_id = s.std_id
                WHERE epr.round_id IN (?)
            `, [licRoundIds]);

            licData.forEach(row => {
                initStudent(row.std_code);
                const r_type = rounds.find(r => r.round_id === row.round_id).round_type;
                
                const status = row.paper_result === 3 ? 'pass' : 'fail';
                const detail = row.paper_result === 3 ? 'ผ่าน' : 'ไม่ผ่าน';
                
                studentMap[row.std_code].rounds[r_type] = { status, detail };
            });
        }

        res.status(200).json({ success: true, data: Object.values(studentMap) });

    } catch (error) {
        console.error("Error fetching matrix summary:", error);
        res.status(500).json({ success: false, message: "Server Error", error });
    } finally {
        connection.release();
    }
});