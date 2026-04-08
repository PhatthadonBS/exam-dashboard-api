import { Router, Request, Response } from "express";
import { conn } from "../config/connect_db.js";

export const dashboard = Router();

dashboard.get('/:round_id', async (req: Request, res: Response): Promise<any> => {
  const roundId = req.params.round_id;
 
  try {
    // 1. Query ข้อมูลรายวิชา
    const sqlSubjects = `
      SELECT 
        s.subject_code AS code, 
        s.subject_name AS name,
        c.full_score AS full,
        c.passing_score AS passCriteria,
        ROUND(AVG(es.score), 2) AS avg,
        ROUND((AVG(es.score) / c.full_score) * 100, 2) AS percent,
        SUM(CASE WHEN es.score >= c.passing_score THEN 1 ELSE 0 END) AS pass,
        SUM(CASE WHEN es.score < c.passing_score THEN 1 ELSE 0 END) AS fail
      FROM exam_scores es
      JOIN subjects s ON es.subject_id = s.subject_id
      JOIN exam_criteria c ON es.subject_id = c.subject_id AND es.round_id = c.round_id
      WHERE es.round_id = ?
      GROUP BY s.subject_id, c.full_score, c.passing_score
    `;
    const [subjectsList]: any = await conn.query(sqlSubjects, [roundId]);

    // 2. Query ข้อมูลรายบุคคล
    const sqlStudents = `
      SELECT 
        es.std_id,
        SUM(CASE WHEN es.score < c.passing_score THEN 1 ELSE 0 END) AS failed_subjects_count,
        AVG((es.score / c.full_score) * 100) AS student_avg_percent
      FROM exam_scores es
      JOIN exam_criteria c ON es.subject_id = c.subject_id AND es.round_id = c.round_id
      WHERE es.round_id = ?
      GROUP BY es.std_id
    `;
    const [studentsData]: any = await conn.query(sqlStudents, [roundId]);

    // 3. คำนวณ Summary และ การกระจายคะแนน (Histogram)
    let passedAll = 0;
    let failedSome = 0;
    let totalPercent = 0;
    let maxScore = 0;
    let minScore = 100;
    
    // 🌟 สร้าง Array เก็บจำนวนคน 10 ช่วง (0-10%, 10-20%, ... 90-100%)
    const distribution = Array(10).fill(0);

    studentsData.forEach((std: any) => {
      if (Number(std.failed_subjects_count) === 0) passedAll++;
      else failedSome++;

      const avgPercent = Number(std.student_avg_percent) || 0;
      totalPercent += avgPercent;
      
      if (avgPercent > maxScore) maxScore = avgPercent;
      if (avgPercent < minScore) minScore = avgPercent;

      // 🌟 นำคะแนนเฉลี่ยมาหา Index ของช่วง (หาร 10 ปัดเศษลง)
      let bucketIndex = Math.floor(avgPercent / 10);
      if (bucketIndex >= 10) bucketIndex = 9; // กรณีได้ 100% เต็ม ให้อยู่ช่องสุดท้าย
      if (bucketIndex < 0) bucketIndex = 0;
      
      distribution[bucketIndex]++; // บวกจำนวนคนเพิ่มในช่องนั้น
    });

    if (studentsData.length === 0) minScore = 0;

    const totalStudents = studentsData.length;
    const avgScore = totalStudents > 0 ? (totalPercent / totalStudents) : 0;

    const summary = {
      totalStudents,
      passedAll,
      failedSome,
      avgScore: Number(avgScore.toFixed(1)),
      maxScore: Number(maxScore.toFixed(1)), 
      minScore: Number(minScore.toFixed(1))  
    };

    // 4. เตรียมข้อมูลสำหรับ Radar Chart
    const radarLabels = subjectsList.map((s: any) => `${s.code} ${s.name}`);
    const radarAvgData = subjectsList.map((s: any) => s.percent);
    const radarCriteriaData = subjectsList.map((s: any) => Number(((s.passCriteria / s.full) * 100).toFixed(1)));

    // 5. Generate AI Insights
    const sortedByPercent = [...subjectsList].sort((a, b) => a.percent - b.percent);
    const weakest = sortedByPercent.slice(0, 2); 
    const strongest = sortedByPercent.slice(-2).reverse();

    const aiInsights = {
      weaknesses: weakest.length > 0 
        ? `วิชา ${weakest.map(w => w.name).join(' และ ')} น่ากังวลที่สุด (เฉลี่ย ${weakest.map(w => w.percent+'%').join(', ')}) มีคนไม่ผ่านรวม ${weakest.reduce((sum, w) => sum + Number(w.fail), 0)} คน` 
        : 'ยังไม่มีข้อมูลเพียงพอ',
      strengths: strongest.length > 0 
        ? `วิชา ${strongest.map(s => s.name).join(' และ ')} ทำผลงานได้ดีที่สุด เกาะกลุ่มคะแนนสูงกว่าเกณฑ์` 
        : 'ยังไม่มีข้อมูลเพียงพอ',
      recommendation: weakest.length > 0 
        ? `ควรจัดคอร์สติวเข้มด่วนในวิชา "${weakest[0]?.name}" ก่อนเป็นอันดับแรก` 
        : 'ภาพรวมอยู่ในเกณฑ์ปกติ'
    };

    // ส่ง Response
    return res.json({
      summary,
      subjectsList,
      radarData: {
        labels: radarLabels,
        avgData: radarAvgData,
        criteriaData: radarCriteriaData
      },
      aiInsights,
      distributionData: distribution // 🌟 ส่งข้อมูลกราฟการกระจายแนบไปด้วย
    });
 
  } catch (error) {
    console.error("Dashboard Error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// =================================================================
// 🌟 API สำหรับหน้ารายบุคคล (ตารางนักศึกษา + กราฟ Radar รายคน)
// =================================================================
dashboard.get('/students/:round_id', async (req: Request, res: Response): Promise<any> => {
  const roundId = req.params.round_id;

  try {
    // 1. Query ข้อมูลนักศึกษารายบุคคล (คะแนนรวม, ผ่าน/ตก, วิชาที่ตก, และอาเรย์คะแนนสำหรับวาดกราฟ)
    const sqlStudents = `
      SELECT 
        st.std_code AS id,
        SUM(es.score) AS total,
        SUM(c.full_score) AS max,
        ROUND((SUM(es.score) / SUM(c.full_score)) * 100, 2) AS percent,
        CASE WHEN SUM(CASE WHEN es.score < c.passing_score THEN 1 ELSE 0 END) > 0 THEN 'fail' ELSE 'pass' END AS status,
        
        -- รวมรหัสวิชาที่ตก คั่นด้วยลูกน้ำ (เช่น "1102, 1104")
        IFNULL(GROUP_CONCAT(CASE WHEN es.score < c.passing_score THEN s.subject_code ELSE NULL END ORDER BY s.subject_code ASC SEPARATOR ', '), '-') AS failedSub,
        
        -- รวมคะแนนทุกวิชาของเด็กคนนี้ เพื่อเอาไปวาดกราฟ Radar (เช่น "26,22,25...")
        GROUP_CONCAT(es.score ORDER BY s.subject_code ASC SEPARATOR ',') AS scoresStr
      FROM students st
      JOIN exam_scores es ON st.std_id = es.std_id
      JOIN exam_criteria c ON es.subject_id = c.subject_id AND es.round_id = c.round_id
      JOIN subjects s ON es.subject_id = s.subject_id
      WHERE es.round_id = ?
      GROUP BY st.std_id, st.std_code
    `;
    const [studentsRaw]: any = await conn.query(sqlStudents, [roundId]);

    // แปลง scoresStr จาก "26,22,25" ให้เป็น Array [26, 22, 25]
    const studentsList = studentsRaw.map((std: any) => ({
      ...std,
      percent: Number(std.percent),
      total: Number(std.total),
      max: Number(std.max),
      scoresArray: std.scoresStr ? std.scoresStr.split(',').map(Number) : []
    }));

    // 2. Query ดึงค่าเฉลี่ยกลุ่มและเกณฑ์ผ่าน (เพื่อเอาไปซ้อนในกราฟ Radar ของเด็ก)
    const sqlSubjects = `
      SELECT 
        s.subject_code AS code, 
        s.subject_name AS name,
        ROUND(AVG(es.score), 2) AS avg_score,
        c.passing_score AS pass_criteria
      FROM exam_scores es
      JOIN subjects s ON es.subject_id = s.subject_id
      JOIN exam_criteria c ON es.subject_id = c.subject_id AND es.round_id = c.round_id
      WHERE es.round_id = ?
      GROUP BY s.subject_id, c.passing_score
      ORDER BY s.subject_code ASC
    `;
    const [subjectsRaw]: any = await conn.query(sqlSubjects, [roundId]);

    // เตรียมข้อมูลเส้นกราฟพื้นฐานให้ Frontend
    const radarLabels = subjectsRaw.map((s: any) => `${s.code} ${s.name}`);
    const groupAvgData = subjectsRaw.map((s: any) => Number(s.avg_score));
    const criteriaData = subjectsRaw.map((s: any) => Number(s.pass_criteria));

    return res.json({
      studentsList,
      radarBase: {
        labels: radarLabels,
        groupAvg: groupAvgData,
        criteria: criteriaData
      }
    });

  } catch (error) {
    console.error("Students List Error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// =================================================================
// 🌟 API สำหรับหน้าข้อมูลรายวิชา (สถิติเชิงลึก: เฉลี่ย, SD, Median, Min, Max)
// =================================================================
dashboard.get('/subjects/:round_id', async (req: Request, res: Response): Promise<any> => {
  const roundId = req.params.round_id;

  try {
    const sql = `
      SELECT 
        s.subject_code AS code, 
        s.subject_name AS name,
        c.full_score AS fullScore,
        c.passing_score AS passScore,
        ROUND(AVG(es.score), 2) AS avg,
        ROUND(STDDEV(es.score), 2) AS sd,
        MIN(es.score) AS min,
        MAX(es.score) AS max,
        SUM(CASE WHEN es.score >= c.passing_score THEN 1 ELSE 0 END) AS passCount,
        COUNT(es.score) AS totalCount,
        -- ดึงคะแนนของทุกคนในวิชานี้เรียงจากน้อยไปมาก เพื่อนำไปหาค่า Median ใน Node.js
        GROUP_CONCAT(es.score ORDER BY es.score ASC SEPARATOR ',') AS all_scores
      FROM exam_scores es
      JOIN subjects s ON es.subject_id = s.subject_id
      JOIN exam_criteria c ON es.subject_id = c.subject_id AND es.round_id = c.round_id
      WHERE es.round_id = ?
      GROUP BY s.subject_id, c.full_score, c.passing_score
      ORDER BY s.subject_code ASC
    `;
    
    const [rawStats]: any = await conn.query(sql, [roundId]);

    // นำข้อมูลที่ได้มาคำนวณ % สอบผ่าน และค่า Median
    const subjectStats = rawStats.map((row: any) => {
      // คำนวณ Pass Rate (%)
      const passRate = row.totalCount > 0 ? Math.round((row.passCount / row.totalCount) * 100) : 0;
      
      // คำนวณ Median (มัธยฐาน)
      let median = 0;
      if (row.all_scores) {
        const scores = row.all_scores.split(',').map(Number);
        const mid = Math.floor(scores.length / 2);
        // ถ้าจำนวนข้อมูลเป็นเลขคี่ ให้เอาตัวตรงกลาง / ถ้าเป็นเลขคู่ ให้เอา 2 ตัวกลางบวกกันหาร 2
        median = scores.length % 2 !== 0 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
      }

      return {
        code: row.code,
        name: row.name,
        fullScore: Number(row.fullScore),
        passScore: Number(row.passScore),
        avg: Number(row.avg) || 0,
        sd: Number(row.sd) || 0,
        min: Number(row.min) || 0,
        max: Number(row.max) || 0,
        passRate: passRate,
        median: Number(median.toFixed(1))
      };
    });

    return res.json({ subjectStats });

  } catch (error) {
    console.error("Subject Stats Error:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});