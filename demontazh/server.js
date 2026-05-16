const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Подключение к PostgreSQL ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.connect()
    .then(() => console.log('✅ PostgreSQL подключен'))
    .catch(err => console.error('❌ Ошибка PostgreSQL:', err));

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.use(session({
    secret: process.env.SECRET_KEY || 'demontazh-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24 часа
    }
}));

// --- Пользователи (из твоего фронтенда) ---
const USERS = {
    'xell': { password: 'adminov', role: 'admin', label: 'Бригадир' },
    'check': { password: 'check', role: 'worker', label: 'Напарник' }
};

// --- Создание таблиц ---
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                type VARCHAR(300) NOT NULL,
                price VARCHAR(50),
                date VARCHAR(50),
                desc TEXT,
                status VARCHAR(20) DEFAULT 'new',
                marks JSONB DEFAULT '{}',
                created VARCHAR(20),
                updated VARCHAR(20)
            );
        `);
        console.log('✅ Таблицы готовы');
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error);
    }
}

initDB();

// --- Вспомогательные функции ---
function formatDate() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}.${month}.${year}`;
}

function formatDateTime() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes}`;
}

// --- Middleware авторизации ---
function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        return next();
    }
    res.status(401).json({ error: 'Не авторизован' });
}

function isAdmin(req, res, next) {
    if (req.session.userRole === 'admin') {
        return next();
    }
    res.status(403).json({ error: 'Доступ запрещён' });
}

// --- API: Логин ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = USERS[username?.toLowerCase()];

    if (!user || user.password !== password) {
        return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    req.session.userId = username;
    req.session.userRole = user.role;
    req.session.userLabel = user.label;

    res.json({
        success: true,
        role: user.role,
        label: user.label
    });
});

// --- API: Выход ---
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// --- API: Получить пользователя ---
app.get('/api/user', isAuthenticated, (req, res) => {
    res.json({
        username: req.session.userId,
        role: req.session.userRole,
        label: req.session.userLabel
    });
});

// --- API: Получить все заказы ---
app.get('/api/orders', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM orders ORDER BY updated DESC, id DESC'
        );
        
        // Преобразуем данные для фронтенда
        const orders = result.rows.map(row => ({
            id: row.id,
            type: row.type,
            price: row.price,
            date: row.date,
            desc: row.desc,
            status: row.status,
            marks: row.marks || {},
            created: row.created,
            updated: row.updated
        }));

        res.json(orders);
    } catch (error) {
        console.error('Ошибка получения заказов:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// --- API: Создать заказ ---
app.post('/api/orders', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const { type, price, date, desc } = req.body;

        if (!type || !date) {
            return res.status(400).json({ error: 'Тип работы и дата обязательны' });
        }

        const now = formatDate();
        const dateTime = formatDateTime();

        const result = await pool.query(
            `INSERT INTO orders (type, price, date, "desc", status, marks, created, updated) 
             VALUES ($1, $2, $3, $4, 'new', '{}', $5, $6) 
             RETURNING *`,
            [type, price || '', date, desc || '', now, dateTime]
        );

        const order = result.rows[0];
        res.json({
            success: true,
            order: {
                id: order.id,
                type: order.type,
                price: order.price,
                date: order.date,
                desc: order.desc,
                status: order.status,
                marks: order.marks || {},
                created: order.created,
                updated: order.updated
            }
        });
    } catch (error) {
        console.error('Ошибка создания заказа:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// --- API: Обновить заказ ---
app.put('/api/orders/:id', isAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        const { type, price, date, desc, status, marks } = req.body;
        const dateTime = formatDateTime();

        // Проверяем существование заказа
        const existing = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Заказ не найден' });
        }

        const order = existing.rows[0];

        // Обновляем только переданные поля
        const updatedType = type !== undefined ? type : order.type;
        const updatedPrice = price !== undefined ? price : order.price;
        const updatedDate = date !== undefined ? date : order.date;
        const updatedDesc = desc !== undefined ? desc : order.desc;
        const updatedStatus = status !== undefined ? status : order.status;
        const updatedMarks = marks !== undefined ? JSON.stringify(marks) : JSON.stringify(order.marks || {});

        const result = await pool.query(
            `UPDATE orders 
             SET type = $1, price = $2, date = $3, "desc" = $4, status = $5, marks = $6, updated = $7
             WHERE id = $8 
             RETURNING *`,
            [updatedType, updatedPrice, updatedDate, updatedDesc, updatedStatus, updatedMarks, dateTime, id]
        );

        const updatedOrder = result.rows[0];
        res.json({
            success: true,
            order: {
                id: updatedOrder.id,
                type: updatedOrder.type,
                price: updatedOrder.price,
                date: updatedOrder.date,
                desc: updatedOrder.desc,
                status: updatedOrder.status,
                marks: updatedOrder.marks || {},
                created: updatedOrder.created,
                updated: updatedOrder.updated
            }
        });
    } catch (error) {
        console.error('Ошибка обновления заказа:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// --- API: Удалить заказ ---
app.delete('/api/orders/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING id', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Заказ не найден' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка удаления заказа:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// --- Отдача HTML страниц ---
app.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'index.html');
    console.log('Пытаюсь отдать файл:', filePath);
    
    // Проверяем существование файла
    const fs = require('fs');
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        console.error('❌ Файл не найден:', filePath);
        console.error('Файлы в папке:', fs.readdirSync(__dirname));
        res.status(404).send('index.html не найден. Проверьте деплой.');
    }
});

// --- Запуск сервера ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`👤 Бригадир: xell / adminov`);
    console.log(`👤 Напарник: check / check`);
});
