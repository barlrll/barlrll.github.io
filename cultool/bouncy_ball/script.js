let previousInputState = null;

document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.main__group__numberInput').forEach(function (input) {
        input.addEventListener('input', calculateScore);
    });

    document.getElementById('clearInput').addEventListener('click', clearInputs);
    document.getElementById('restoreInput').addEventListener('click', restoreInputs);
    document.getElementById('returnTop').addEventListener('click', function () {
        window.location.href = './../';
    });
});

function getInputValue(inputId) {
    const input = document.getElementById(inputId);
    const value = Number(input.value);

    if (
        input.value === '' ||
        !Number.isFinite(value) ||
        value < 0 ||
        !Number.isInteger(value)
    ) {
        return null;
    }

    return value;
}

function calculateScore() {
    const result1 = getInputValue('result1');
    const result2 = getInputValue('result2');
    const result3 = getInputValue('result3');
    const scoreDisplay = document.getElementById('scoreDisplay');

    scoreDisplay.textContent = result1 * 300 + result2 * 100 + result3 * 20;
}

function clearInputs() {
    if (!previousInputState) {
        previousInputState = {
            inputs: [...document.querySelectorAll('.main__group__numberInput')].map(
                function (input) {
                    return { id: input.id, value: input.value };
                },
            ),
            score: document.getElementById('scoreDisplay').textContent,
        };
    }

    document.querySelectorAll('.main__group__numberInput').forEach(function (input) {
        input.value = '';
    });

    document.getElementById('scoreDisplay').textContent = '?';
    document.getElementById('restoreInput').disabled = false;
}

function restoreInputs() {
    if (!previousInputState) {
        return;
    }

    previousInputState.inputs.forEach(function (inputState) {
        document.getElementById(inputState.id).value = inputState.value;
    });
    document.getElementById('scoreDisplay').textContent = previousInputState.score;
    previousInputState = null;
    document.getElementById('restoreInput').disabled = true;
}
