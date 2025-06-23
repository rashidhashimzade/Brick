document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('play-btn')?.addEventListener('click', () => {
        window.location.href = 'matchmaking.html';
    });

    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const time = btn.dataset.time;
            if (time === '10+0') {
                window.location.href = 'matchmaking.html';
            } else {
                alert(`Time control ${time} is not available yet.`);
            }
        });
    });
});
