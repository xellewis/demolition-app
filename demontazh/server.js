const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/orders', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, type, price, date, description, status, marks, created_at FROM orders ORDER BY created_at DESC'
    );

    res.json(result.rows.map(row => ({
      id: row.id,
      type: row.type,
      price: row.price,
      date: row.date,
      desc: row.description || '',
      status: row.status,
      marks: row.marks || {},
      created: row.created_at
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { type, price, date, desc = '' } = req.body;
    if (!type || !price || !date) {
      return res.status(400).json({ error: 'type, price and date are required' });
    }

    const id = Date.now().toString();

    const result = await pool.query(
      `INSERT INTO orders (id, type, price, date, description, status, marks)
       VALUES ($1, $2, $3, $4, $5, 'new', $6)
       RETURNING *`,
      [id, type, Number(price), date, desc, {}]
    );

    const row = result.rows[0];
    res.status(201).json({
      id: row.id,
      type: row.type,
      price: row.price,
      date: row.date,
      desc: row.description || '',
      status: row.status,
      marks: row.marks || {},
      created: row.created_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, price, date, desc, status, marks } = req.body;

    const current = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (!current.rows.length) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const row = current.rows[0];

    const updated = await pool.query(
      `UPDATE orders
       SET type = COALESCE($1, type),
           price = COALESCE($2, price),
           date = COALESCE($3, date),
           description = COALESCE($4, description),
           status = COALESCE($5, status),
           marks = COALESCE($6, marks)
       WHERE id = $7
       RETURNING *`,
      [
        type ?? null,
        price !== undefined ? Number(price) : null,
        date ?? null,
        desc ?? null,
        status ?? null,
        marks ?? null,
        id
      ]
    );

    const r = updated.rows[0];
    res.json({
      id: r.id,
      type: r.type,
      price: r.price,
      date: r.date,
      desc: r.description || '',
      status: r.status,
      marks: r.marks || {},
      created: r.created_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM orders WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});