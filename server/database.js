// server/database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'nexus.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Ошибка подключения к БД:', err.message);
  else {
    console.log('💾 Подключено к базе данных SQLite (nexus.db)');
    initTables();
  }
});

function initTables() {
  db.serialize(() => {
    // 1. Сообщения (ДОБАВЛЕНО ПОЛЕ reactions)
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user TEXT,
      to_user TEXT,
      text TEXT,
      image TEXT,
      fileName TEXT,
      timestamp TEXT,
      reactions TEXT DEFAULT '{}' 
    )`);

    // 2. Пользователи
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      avatar TEXT,
      bio TEXT
    )`);
  });
}

module.exports = db;
