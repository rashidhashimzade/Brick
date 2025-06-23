const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const { Noise } = require('noisejs');

app.use(express.static('public'));

const rows = 10, cols = 6;
let players = [];
let currentTurn = null;
let gridVals = [];
let lastWall = null;
let timers = {};
let interval = null;
const MAX_TIME = 600_000;

function makeWall() {
    // 1) Create a new Perlin noise generator with a fresh seed
    const noise = new Noise(Math.random());

    // 2) Prepare the empty grid
    const ch = Array.from({ length: rows }, () => Array(cols).fill(0));

    // 3) Tweak these to taste
    const scale = 0.25;  // controls blob size (higher = smaller blobs)
    const threshold = 0.2;   // controls density (lower = more bricks)

    // 4) Center coordinates
    const centerX = Math.floor(rows / 2);
    const centerY = Math.floor(cols / 2);

    // 5) Generate bricks based on Perlin noise + center bias
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            const dx = i - centerX;
            const dy = j - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const distFac = 1 - Math.min(dist / (rows / 2), 1);     // 1 at center → 0 at edges
            const n = noise.perlin2(i * scale, j * scale);  // in range [-1,1]

            // boost + bias toward center
            if ((n + 0.5) * distFac > threshold) {
                ch[i][j] = 1;
            }
        }
    }

    // 6) Guarantee the very center is solid
    ch[centerX][centerY] = 1;

    // 7) Flood-fill from center, keep only that connected component
    const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
    const queue = [[centerX, centerY]];
    visited[centerX][centerY] = true;

    const dirs = [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [1, -1], [-1, 1], [1, 1]
    ];

    while (queue.length) {
        const [x, y] = queue.shift();
        for (const [dx, dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (
                nx >= 0 && nx < rows &&
                ny >= 0 && ny < cols &&
                !visited[nx][ny] &&
                ch[nx][ny] === 1
            ) {
                visited[nx][ny] = true;
                queue.push([nx, ny]);
            }
        }
    }

    // 8) Remove any brick that wasn't reached
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            if (ch[i][j] === 1 && !visited[i][j]) {
                ch[i][j] = 0;
            }
        }
    }

    return ch;
}


function countBricks(grid) {
    let count = 0;
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
            if (grid[r][c] === 1) count++;
    return count;
}

function hasAdjacentBrick(grid, i, j) {
    const directions = [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [1, -1]
    ];
    for (const [dx, dy] of directions) {
        const x = i + dx, y = j + dy;
        if (x >= 0 && x < rows && y >= 0 && y < cols) {
            if (grid[x][y] === 1) return true;
        }
    }
    return false;
}

// Utility to shuffle array (Fisher-Yates)
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}


function resetGame(ch) {
    currentTurn = players[0];
    gridVals = Array.from({ length: rows }, () => Array(cols).fill(null));
    for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++)
            if (ch[i][j] !== 1) gridVals[i][j] = undefined;

    timers = {
        [players[0]]: MAX_TIME,
        [players[1]]: MAX_TIME
    };
    startTimer();
}

function broadcastTimers() {
    io.emit('timer-update', {
        timers: {
            [players[0]]: timers[players[0]],
            [players[1]]: timers[players[1]]
        }
    });
}

function startTimer() {
    if (interval) clearInterval(interval);
    let lastTick = Date.now();
    interval = setInterval(() => {
        if (!currentTurn || !timers[currentTurn]) return;
        const now = Date.now();
        const delta = now - lastTick;
        lastTick = now;
        timers[currentTurn] -= delta;
        broadcastTimers();
        if (timers[currentTurn] <= 0) {
            const loser = currentTurn;
            const winner = players.find(p => p !== loser);
            io.emit('game-over', { loser, winner });
            stopGame();
        }
    }, 1000);
}

function stopGame() {
    clearInterval(interval);
    players = [];
    currentTurn = null;
    lastWall = null;
    gridVals = [];
    timers = {};
}

function checkMove(i, j) {
    const a = gridVals;
    const v = a[i]?.[j];
    if (v == null) return true;

    function get(x, y) {
        if (x < 0 || x >= rows || y < 0 || y >= cols) return undefined;
        return a[x][y];
    }

    function rule(x1, y1, x2, y2, x3, y3) {
        const p = get(x1, y1), q = get(x2, y2), r = get(x3, y3);
        if (p != null && q != null && r != null) return p + q === r;
        return true;
    }

    if (i % 2 === 1) {
        return rule(i - 1, j, i - 1, j + 1, i, j) &&
            rule(i, j, i, j + 1, i + 1, j + 1) &&
            rule(i, j, i, j - 1, i - 1, j) &&
            rule(i, j, i, j + 1, i - 1, j + 1) &&
            rule(i, j, i, j - 1, i + 1, j) &&
            rule(i + 1, j, i + 1, j + 1, i, j);
    } else {
        return rule(i - 1, j, i - 1, j - 1, i, j) &&
            rule(i, j, i, j + 1, i + 1, j) &&
            rule(i, j, i, j - 1, i + 1, j - 1) &&
            rule(i, j, i, j + 1, i - 1, j) &&
            rule(i, j, i, j - 1, i - 1, j - 1) &&
            rule(i + 1, j, i + 1, j - 1, i, j);
    }
}

function isDraw() {
    for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++)
            if (gridVals[i][j] === null || !checkMove(i, j)) return false;
    return true;
}

io.on('connection', socket => {
    console.log('⇄ connect', socket.id);

    if (players.length < 2) {
        players.push(socket.id);
        socket.emit('role-assigned', { role: players.length });
        if (players.length === 2) {
            lastWall = makeWall();
            resetGame(lastWall);
            io.emit('wall-data', { ch: lastWall, currentTurn });
            io.emit('turn-changed', { currentTurn });
        }
    } else {
        socket.emit('role-assigned', { role: 0 });
        if (lastWall) {
            socket.emit('wall-data', { ch: lastWall, currentTurn });
            socket.emit('turn-changed', { currentTurn });
        }
    }

    socket.on('brick-update', ({ row, col, value }) => {
        if (socket.id !== currentTurn || gridVals[row][col] !== null) return;
        gridVals[row][col] = value;
        const valid = checkMove(row, col);
        io.emit('brick-update', { row, col, value });
        if (!valid) {
            const loser = socket.id;
            const winner = players.find(p => p !== loser);
            io.emit('game-over', { loser, winner });
            stopGame();
        } else if (isDraw()) {
            io.emit('game-over', { loser: null, winner: null });
            stopGame();
        } else {
            currentTurn = players.find(p => p !== socket.id);
            io.emit('turn-changed', { currentTurn });
        }
    });

    socket.on('timeout', () => {
        const loser = socket.id;
        const winner = players.find(p => p !== loser);
        io.emit('game-over', { loser, winner });
        stopGame();
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p !== socket.id);
        if (players.length < 2) {
            stopGame();
            io.emit('turn-changed', { currentTurn: null });
        }
    });

    socket.on('chat-message', ({ text }) => {
        io.emit('chat-message', { from: socket.id, text });
    });


});

server.listen(3000, () => {
    console.log('Server running at http://localhost:3000');
});
