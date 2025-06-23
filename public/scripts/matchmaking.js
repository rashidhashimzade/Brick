const socket = io();

// Check when two players are ready
socket.on('role-assigned', ({ role }) => {
    if (role === 1 || role === 2) {
        // Wait for second player
        socket.on('wall-data', () => {
            window.location.href = 'game.html';
        });
    }
});

