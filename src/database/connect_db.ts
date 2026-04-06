import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

export const conn = mysql.createPool({
  host: "localhost",
  user: process.env.USER,
  password: process.env.PASSWD,
  database: process.env.DATABASE,
  port: Number(process.env.PORT),
  connectionLimit: 10, // จำกัดจำนวน connection พร้อมกัน
  waitForConnections: true,
  queueLimit: 0, // 0 = ไม่จำกัดคิว (ระวังงานยาวมาก)
});
