import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

export const conn = mysql.createPool({ 
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWD,
  database: process.env.DB_DATABASE,
  port: Number(process.env.DB_PORT),
  connectionLimit: 10, // จำกัดจำนวน connection พร้อมกัน
  waitForConnections: true,
  queueLimit: 0, // 0 = ไม่จำกัดคิว (ระวังงานยาวมาก)
});
