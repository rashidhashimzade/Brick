const socket = io();
const wall = document.getElementById('wall');
const panel = document.getElementById('panel');
const playerSpan = document.getElementById('playerRole');
const turnSpan = document.getElementById('turn-status');
const timerSelf = document.getElementById('timerSelf');
const timerOpponent = document.getElementById('timerOpponent');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const messagesEl = document.getElementById('messages');

const rows = 10, cl = 6;
const brickWidth = 60;
const brickHeight = 30;
const spacing = 5;

const INITIAL_TIME = 600_000; // 10 minutes in ms
let timers = { self: INITIAL_TIME, opponent: INITIAL_TIME };
let myRole = 0;
let currentTurn = null;
let selectedBrick = null;
let gameOver = false;
let lockedBricks = Array.from({ length: rows }, () => Array(cl).fill(false));
let activeTimer = null;
let lastTick = null;

function isDraw() {
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            if (gridVals[i][j] === null) return false; // not all filled
            if (!checkMove(i, j)) return false; // invalid math somewhere
        }
    }
    return true;
}

function addMessage(text, sender) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper ' + (sender === 'self' ? 'self' : 'other');

    const msg = document.createElement('div');
    msg.className = 'message ' + (sender === 'self' ? 'self' : 'other');
    msg.textContent = text;

    wrapper.appendChild(msg);
    messagesEl.appendChild(wrapper);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}


socket.on('chat-message', ({ from, text }) => {
    addMessage(text, from === socket.id ? 'self' : 'other');
});



// Grid of pixel positions
function generateGridPositions(rows, cols) {
    const gridPositions = [];
    for (let r = 0; r < rows; r++) {
        const row = [];
        const offset = (r % 2 === 1) ? (brickWidth + spacing) / 2 : 0;
        for (let c = 0; c < cols; c++) {
            const x = c * (brickWidth + spacing) + offset;
            const y = r * (brickHeight + spacing);
            row.push({ x, y });
        }
        gridPositions.push(row);
    }
    return gridPositions;
}

const gridPositions = generateGridPositions(rows, cl);

// Format mm:ss
function format(ms) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

socket.on('timer-update', ({ timers: serverTimers }) => {
    if (!myRole || !socket.id) return;
    const opponentId = Object.keys(serverTimers).find(id => id !== socket.id);
    const myTime = serverTimers[socket.id] ?? 0;
    const opponentTime = serverTimers[opponentId] ?? 0;

    timers.self = myTime;
    timers.opponent = opponentTime;

    // update display
    document.getElementById('timerSelf').textContent = `You: ${format(timers.self)}`;
    document.getElementById('opponent-timer-bar').textContent = `Opponent time: ${format(timers.opponent)}`;
});

function updateTimers() {
    const now = Date.now();
    if (!lastTick || !activeTimer || gameOver) {
        lastTick = now;
        return;
    }
    const delta = now - lastTick;
    if (timers[activeTimer] != null) {
        timers[activeTimer] -= delta;
    }
    lastTick = now;
}

function updateTimerDisplay() {
    timerSelf.textContent = `You: ${format(timers.self)}`;
    timerOpponent.textContent = `Opponent: ${format(timers.opponent)}`;
}

let timerInterval = setInterval(updateTimers, 1000);

function drawWall(ch) {
    wall.innerHTML = '';
    wall.style.position = 'relative';
    wall.style.height = `${rows * (brickHeight + spacing)}px`;

    selectedBrick = null;
    lockedBricks = Array.from({ length: rows }, () => Array(cl).fill(false));

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cl; c++) {
            if (ch[r][c] === 1) {
                const brick = document.createElement('div');
                brick.className = 'brick';
                brick.dataset.row = r;
                brick.dataset.col = c;

                const pos = gridPositions[r][c];
                brick.style.position = 'absolute';
                brick.style.left = `${pos.x}px`;
                brick.style.top = `${pos.y}px`;

                brick.onclick = () => {
                    if (gameOver || myRole === 0 || socket.id !== currentTurn || lockedBricks[r][c]) return;
                    if (selectedBrick) selectedBrick.style.outline = '';
                    selectedBrick = brick;
                    brick.style.outline = '3px solid yellow';
                };

                wall.appendChild(brick);
            }
        }
    }
}

function drawPanel() {
    panel.innerHTML = '';
    for (let i = 0; i < 10; i++) {
        const nb = document.createElement('div');
        nb.className = 'brick';
        nb.textContent = i;
        nb.onclick = () => {
            if (gameOver || !selectedBrick || socket.id !== currentTurn) return;
            const r = +selectedBrick.dataset.row;
            const c = +selectedBrick.dataset.col;
            if (lockedBricks[r][c]) return;

            selectedBrick.textContent = i;
            selectedBrick.classList.add('filled');
            lockedBricks[r][c] = true;
            selectedBrick.style.outline = '';
            socket.emit('brick-update', { row: r, col: c, value: i });
            selectedBrick = null;
        };
        panel.appendChild(nb);
    }
}

socket.on('role-assigned', ({ role }) => {
    myRole = role;
    const playerNumEl = document.getElementById('player-number');
    if (role === 0) {
        playerNumEl.textContent = 'Spectator';
    } else {
        playerNumEl.textContent = `You are Player ${role}`;
    }
});

// update turn info on turn-changed
socket.on('turn-changed', ({ currentTurn: ct }) => {
    currentTurn = ct;
    const turnEl = document.getElementById('turn-status');
    if (gameOver) {
        turnEl.textContent = 'Game Over';
        return;
    }
    if (socket.id === ct) {
        turnEl.textContent = 'Your turn';
    } else if (ct === null) {
        turnEl.textContent = 'Waiting for players...';
    } else {
        turnEl.textContent = "Opponent's turn";
    }
});

chatForm.addEventListener('submit', e => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat-message', { text });
    chatInput.value = '';
});


socket.on('wall-data', ({ ch, currentTurn: ct }) => {
    drawWall(ch);
    drawPanel();
    currentTurn = ct;
    gameOver = false;
    turnSpan.textContent = socket.id === ct ? 'Your turn' : 'Opponent\'s turn';
    activeTimer = socket.id === ct ? 'self' : 'opponent';
    lastTick = Date.now();
    updateTimerDisplay();
});

socket.on('brick-update', ({ row, col, value }) => {
    const brick = wall.querySelector(`.brick[data-row="${row}"][data-col="${col}"]`);
    if (!brick) return;
    brick.textContent = value;
    brick.classList.add('filled');
    lockedBricks[row][col] = true;
});

socket.on('game-over', ({ loser, winner }) => {
    gameOver = true;
    let resultText = 'Game Over';
    if (loser === null && winner === null) {
        resultText += ' – Draw!';
    } else if (socket.id === winner) {
        resultText += ' – You won! 🏆';
    } else if (socket.id === loser) {
        resultText += ' – You lost! ❌';
    }
    turnSpan.textContent = resultText;
    updateTimerDisplay();
});



