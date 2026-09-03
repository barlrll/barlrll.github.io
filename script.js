document.addEventListener('DOMContentLoaded', function () {
    const ringTossButton = document.getElementById('ringToss');
    const bouncyBallButton = document.getElementById('bouncyBall');

    if (ringTossButton) {
        ringTossButton.addEventListener('click', function () {
            window.location.href = 'ring_toss';
        });
    }

    if (bouncyBallButton) {
        bouncyBallButton.addEventListener('click', function () {
            window.location.href = 'bouncy_ball';
        });
    }
});