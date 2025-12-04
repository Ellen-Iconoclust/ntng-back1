const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// PostgreSQL connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test database connection
pool.connect()
    .then(() => console.log('Connected to Neon PostgreSQL database'))
    .catch(err => console.error('Database connection error:', err));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Register endpoint
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Validate input
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check if username already exists
        const usernameCheck = await pool.query(
            'SELECT id FROM users WHERE username = $1',
            [username]
        );

        if (usernameCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        // Check if email already exists
        const emailCheck = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );

        if (emailCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Create new user
        const result = await pool.query(
            `INSERT INTO users (username, email, password, created_at, last_login) 
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
             RETURNING id, username, email, created_at`,
            [username, email, password]
        );

        res.json({
            message: 'User registered successfully',
            user: result.rows[0]
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Check user credentials
        const result = await pool.query(
            `SELECT id, username, email, created_at FROM users 
             WHERE email = $1 AND password = $2`,
            [email, password]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Update last login time
        await pool.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
            [result.rows[0].id]
        );

        res.json({
            message: 'Login successful',
            user: result.rows[0]
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Save game score endpoint
app.post('/api/game-score', async (req, res) => {
    try {
        const { userId, gameType, score } = req.body;

        // Validate input
        if (!userId || !gameType || score === undefined) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Save game score
        await pool.query(
            `INSERT INTO game_scores (user_id, game_type, score, played_at) 
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
            [userId, gameType, score]
        );

        res.json({ message: 'Game score saved successfully' });
    } catch (error) {
        console.error('Save game score error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user stats endpoint
app.get('/api/stats/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;

        // Get total games played
        const totalGamesQuery = await pool.query(
            'SELECT COUNT(*) as total FROM game_scores WHERE user_id = $1',
            [userId]
        );

        // Get best clicker score (highest score for clicker game)
        const bestClickerQuery = await pool.query(
            'SELECT MAX(score) as best_score FROM game_scores WHERE user_id = $1 AND game_type = $2',
            [userId, 'clicker']
        );

        // Get best memory moves (lowest moves for memory game)
        const bestMemoryQuery = await pool.query(
            'SELECT MIN(score) as best_moves FROM game_scores WHERE user_id = $1 AND game_type = $2',
            [userId, 'memory']
        );

        // Get recent games
        const recentGamesQuery = await pool.query(
            `SELECT game_type, score, played_at 
             FROM game_scores 
             WHERE user_id = $1 
             ORDER BY played_at DESC 
             LIMIT 10`,
            [userId]
        );

        res.json({
            stats: {
                totalGames: parseInt(totalGamesQuery.rows[0]?.total) || 0,
                bestClickerScore: parseInt(bestClickerQuery.rows[0]?.best_score) || 0,
                bestMemoryMoves: parseInt(bestMemoryQuery.rows[0]?.best_moves) || 0,
                recentGames: recentGamesQuery.rows
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all users (for admin/console access)
app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, email, created_at, last_login FROM users ORDER BY created_at DESC'
        );
        res.json({ users: result.rows });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all game scores (for admin/console access)
app.get('/api/game-scores', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT gs.*, u.username 
            FROM game_scores gs 
            JOIN users u ON gs.user_id = u.id 
            ORDER BY gs.played_at DESC
        `);
        res.json({ scores: result.rows });
    } catch (error) {
        console.error('Get game scores error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve the main HTML file for all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        pool.end();
    });
});

module.exports = app;
