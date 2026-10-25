const toggleButton = document.getElementById('toggle');

function setTheme(theme) {
	document.documentElement.dataset.theme = theme;
	try {
		localStorage.setItem('theme', theme);
	} catch (e) {
		// ignore
	}
	if (toggleButton) {
		const isDark = theme === 'dark';
		toggleButton.setAttribute('aria-pressed', isDark ? 'true' : 'false');
		toggleButton.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
	}
}

function initTheme() {
	const current = document.documentElement.dataset.theme || 'light';
	setTheme(current);
}

if (toggleButton) {
	toggleButton.addEventListener('click', () => {
		const current = document.documentElement.dataset.theme || 'light';
		setTheme(current === 'dark' ? 'light' : 'dark');
	});
}

initTheme();

// --- Screen switching (each screen is one div; page never reloads) ---
const screenEl = document.getElementById('screen');

const screens = {
	menu: `
		<div class="box">
			<h2>Title</h2>
			<hr class="divider">
			<button type="button" data-goto="local">On this device</button>
			<button type="button" data-goto="online">On two different devices</button>
		</div>`,
	local: `
		<div class="box">
			<h2>On this device</h2>
			<hr class="divider">
			<button type="button" data-goto="game">Start game</button>
			<button type="button" data-goto="menu">Back</button>
		</div>`,
	online: `
		<div class="box">
			<h2>On two different devices</h2>
			<hr class="divider">
			<p id="online-status">Online game goes here.</p>
			<button type="button" data-goto="game">Start game</button>
			<button type="button" data-goto="menu">Back</button>
		</div>`,
	game: `
		<div class="box">
			<h2>Game</h2>
			<hr class="divider" id="game-divider">
			<div id="game-holder">
				<div class="player" id="player1">
					<h3>Player 1</h3>
					<div class="hand">Left hand<span class="bullets" id="p1-left"></span></div>
					<div class="hand">Right hand<span class="bullets" id="p1-right"></span></div>
				</div>
				<div class="vdivider"></div>
				<div class="player" id="player2">
					<h3>Player 2</h3>
					<div class="hand">Left hand<span class="bullets" id="p2-left"></span></div>
					<div class="hand">Right hand<span class="bullets" id="p2-right"></span></div>
				</div>
			</div>
			<p id="game-status"></p>
			<button type="button" data-goto="menu">Quit to menu</button>
		</div>`,
};

// Bullets per hand. Reload adds 1; Shoot spends from the hand(s) used.
const bullets = {
	p1: { left: 0, right: 0 },
	p2: { left: 0, right: 0 },
};

function renderBullets() {
	for (const player of ['p1', 'p2']) {
		for (const hand of ['left', 'right']) {
			const el = document.getElementById(`${player}-${hand}`);
			const count = bullets[player][hand];
			if (el) el.textContent = '●'.repeat(count) + '○'.repeat(Math.max(0, 3 - count));
		}
	}
}

// Turn state: each player locks in one move; both are revealed together.
let currentScreen = 'menu';
let turn = { p1: null, p2: null };
let revealing = false;
let revealTimer = null;

function setStatus(text) {
	const el = document.getElementById('game-status');
	if (el) el.textContent = text;
}

function resetTurn() {
	turn = { p1: null, p2: null };
	revealing = false;
	setStatus('Waiting for both players...');
}

function showScreen(name) {
	if (!screens[name]) return;
	screenEl.innerHTML = screens[name];
	currentScreen = name;
	clearTimeout(revealTimer);
	if (name === 'game') {
		resetTurn();
		renderBullets();
	}
	// Hook for later: open the WebSocket when entering 'online',
	// close it when leaving.
}

document.addEventListener('click', (event) => {
	const target = event.target.closest('[data-goto]');
	if (target) {
		showScreen(target.dataset.goto);
	}
});

showScreen('menu');

// --- Key bindings (one keyboard, two players) ---
// Order in each row: shoot, reload, shield, mirror, double
const ACTIONS = ['shoot', 'reload', 'shield', 'mirror', 'double'];
const KEY_ROWS = {
	p1: { left: '12345', right: 'qwert' },
	p2: { left: '67890', right: 'yuiop' },
};
const keyMap = {};
const doubleKeys = { p1: [], p2: [] };
for (const player in KEY_ROWS) {
	for (const hand in KEY_ROWS[player]) {
		[...KEY_ROWS[player][hand]].forEach((key, i) => {
			keyMap[key] = { player, hand, action: ACTIONS[i] };
			if (ACTIONS[i] === 'double') doubleKeys[player].push(key);
		});
	}
}

const heldKeys = new Set();

function describeMove(move) {
	const name = move.action.charAt(0).toUpperCase() + move.action.slice(1);
	return move.hand === 'both' ? `Double ${name}` : `${name} (${move.hand} hand)`;
}

function revealMoves() {
	revealing = true;
	setStatus(`Player 1: ${describeMove(turn.p1)} | Player 2: ${describeMove(turn.p2)}`);
	revealTimer = setTimeout(resetTurn, 2500);
}

document.addEventListener('keydown', (event) => {
	if (event.repeat) return;
	const key = event.key.toLowerCase();
	heldKeys.add(key);
	if (currentScreen !== 'game' || revealing) return;

	const bind = keyMap[key];
	if (!bind || bind.action === 'double' || turn[bind.player]) return;

	// Holding a double key while pressing Shoot or Shield makes it a double move.
	const move = { action: bind.action, hand: bind.hand };
	const doubleHeld = doubleKeys[bind.player].some((k) => heldKeys.has(k));
	if (doubleHeld && (bind.action === 'shoot' || bind.action === 'shield')) {
		move.hand = 'both';
	}
	turn[bind.player] = move;

	if (turn.p1 && turn.p2) {
		revealMoves();
	} else {
		const n = bind.player === 'p1' ? 1 : 2;
		setStatus(`Player ${n} is ready. Waiting for Player ${3 - n}...`);
	}
});

document.addEventListener('keyup', (event) => heldKeys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => heldKeys.clear());
