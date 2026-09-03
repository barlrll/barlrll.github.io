let previousInputState = null;

document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.main__group__button--choice').forEach(function (button) {
        button.addEventListener('click', function () {
            selectButton(button.dataset.choiceGroup, button);
        });
    });

    document.querySelectorAll('.main__group__button--choice').forEach(function (button) {
        button.addEventListener('click', function () {
            calculateScore();
        });
    });

    document.getElementById('clearInput').addEventListener('click', clearInputs);
    document.getElementById('restoreInput').addEventListener('click', restoreInputs);
    document.getElementById('returnTop').addEventListener('click', function () {
        window.location.href = './../';
    });
});

function selectButton(groupName, selectedButton) {
    document.querySelectorAll(
        '.main__group__button--choice[data-choice-group="' + groupName + '"]',
    ).forEach(function (button) {
        button.setAttribute('aria-pressed', String(button === selectedButton));
    });
}

function getSelectedButton(groupName) {
    return document.querySelector(
        '.main__group__button--choice[data-choice-group="' + groupName + '"][aria-pressed="true"]',
    );
}

function calculateScore() {
    const selectedDifficulty = getSelectedButton('difficulty')?.value;
    const selectedResult1 = getSelectedButton('result1')?.value;
    const selectedResult2 = getSelectedButton('result2')?.value;
    const selectedResult3 = getSelectedButton('result3')?.value;

    const scoreDisplay = document.getElementById('scoreDisplay');

    const scoreList = {
        1: {
            1: 300,
            2: 100,
            3: 0
        },
        2: {
            1: 500,
            2: 200,
            3: 0
        },
    }

    if (selectedDifficulty && selectedResult1 && selectedResult2 && selectedResult3) {
        const score = scoreList[selectedDifficulty][selectedResult1] +
            scoreList[selectedDifficulty][selectedResult2] +
            scoreList[selectedDifficulty][selectedResult3];
        scoreDisplay.textContent = score;
    }
    else {
        scoreDisplay.textContent = '?';
    }
}

function clearInputs() {
    if (!previousInputState) {
        previousInputState = {
            buttons: [...document.querySelectorAll('.main__group__button--choice')].map(
                function (button) {
                    return {
                        id: button.id,
                        pressed: button.getAttribute('aria-pressed'),
                    };
                },
            ),
            score: document.getElementById('scoreDisplay').textContent,
        };
    }

    document.querySelectorAll('.main__group__button--choice').forEach(function (button) {
        button.setAttribute('aria-pressed', 'false');
    });

    document.getElementById('scoreDisplay').textContent = '?';
    document.getElementById('restoreInput').disabled = false;
}

function restoreInputs() {
    if (!previousInputState) {
        return;
    }

    previousInputState.buttons.forEach(function (buttonState) {
        document
            .getElementById(buttonState.id)
            .setAttribute('aria-pressed', buttonState.pressed);
    });
    document.getElementById('scoreDisplay').textContent = previousInputState.score;
    previousInputState = null;
    document.getElementById('restoreInput').disabled = true;
}