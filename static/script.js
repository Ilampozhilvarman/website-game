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
					<div class="hand">Left hand<span class="bullets" id="p1-left"></span><span class="keys" id="p1-left-keys"></span></div>
					<div class="hand">Right hand<span class="bullets" id="p1-right"></span><span class="keys" id="p1-right-keys"></span></div>
				</div>
				<div class="vdivider"></div>
				<div class="player" id="player2">
					<h3>Player 2</h3>
					<div class="hand">Left hand<span class="bullets" id="p2-left"></span><span class="keys" id="p2-left-keys"></span></div>
					<div class="hand">Right hand<span class="bullets" id="p2-right"></span><span class="keys" id="p2-right-keys"></span></div>
				</div>
			</div>
			<p id="game-status"></p>
			<div class="help-overlay" id="help" hidden>
				<div class="help-card">
					<h3>How to play</h3>
					<ul>
					<li>Both players pick one move each turn using the keyboard. Moves are revealed together.</li>
					<li><b>Player 1:</b> left hand <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> <kbd>5</kbd>, right hand <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> <kbd>T</kbd></li>
					<li><b>Player 2:</b> left hand <kbd>6</kbd> <kbd>7</kbd> <kbd>8</kbd> <kbd>9</kbd> <kbd>0</kbd>, right hand <kbd>Y</kbd> <kbd>U</kbd> <kbd>I</kbd> <kbd>O</kbd> <kbd>P</kbd></li>
					<li>In each row the keys are: Shoot, Reload, Shield, Mirror, Double.</li>
					<li><b>Double:</b> hold the Double key, then press Shoot or Shield to use both hands.</li>
					<li><b>Shoot</b> needs ammo (1 in that hand; a double Shoot needs 3 in each hand). <b>Reload</b> adds 1 ammo (max 3).</li>
					<li><b>Shield</b> blocks a Shoot, but only every other turn. <b>Mirror</b> reflects a Shoot back at the shooter.</li>
					<li>A double Shoot beats a single Shield and Mirror. Only a double Shield stops it.</li>
					<li>If both players Shoot, the shots cancel. Get shot and you lose.</li>
				</ul>
					<button type="button" id="help-close">Close</button>
				</div>
			</div>
			<div class="actions">
				<button type="button" id="help-open">How to play</button>
				<button type="button" data-goto="menu">Quit to menu</button>
			</div>
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
let gameOver = false;
const shieldedLastTurn = { p1: false, p2: false }; // Shield is usable once every two turns
const MAX_AMMO = 3;

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
		for (const p of ['p1', 'p2']) {
			bullets[p].left = 0;
			bullets[p].right = 0;
			shieldedLastTurn[p] = false;
		}
		gameOver = false;
		resetTurn();
		renderBullets();
		renderKeyLegend();
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

// Display only: shows which key does which move. These are not clickable.
const KEY_LABELS = ['Shoot', 'Reload', 'Shield', 'Mirror', 'Double (hold)'];

function renderKeyLegend() {
	for (const player in KEY_ROWS) {
		for (const hand in KEY_ROWS[player]) {
			const el = document.getElementById(`${player}-${hand}-keys`);
			if (!el) continue;
			el.innerHTML = [...KEY_ROWS[player][hand]]
				.map((k, i) => `<span class="key"><kbd>${k.toUpperCase()}</kbd>${KEY_LABELS[i]}</span>`)
				.join('');
		}
	}
}

const heldKeys = new Set();

function isHelpOpen() {
	const help = document.getElementById('help');
	return !!help && !help.hidden;
}

document.addEventListener('click', (event) => {
	const help = document.getElementById('help');
	if (!help) return;
	if (event.target.closest('#help-open')) help.hidden = false;
	else if (event.target.closest('#help-close') || event.target === help) help.hidden = true;
});

document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape') {
		const help = document.getElementById('help');
		if (help) help.hidden = true;
	}
});

function describeMove(move) {
	const name = move.action.charAt(0).toUpperCase() + move.action.slice(1);
	return move.hand === 'both' ? `Double ${name}` : `${name} (${move.hand} hand)`;
}

// Returns an error message if the move isn't allowed, otherwise null.
function checkMove(player, move) {
	const hands = move.hand === 'both' ? ['left', 'right'] : [move.hand];
	if (move.action === 'shoot') {
		const need = move.hand === 'both' ? 3 : 1;
		if (hands.some((h) => bullets[player][h] < need)) return 'Not enough ammo for that shot.';
	}
	if (move.action === 'shield' && shieldedLastTurn[player]) return 'Shield needs a turn to recharge.';
	return null;
}

// What happens to one shot against the other player's move.
// Assumption: a double Shoot beats a single Shield and a Mirror; only a double Shield stops it.
function shotOutcome(shot, defense) {
	const isDouble = shot.hand === 'both';
	if (defense.action === 'shoot') return 'cancel';
	if (defense.action === 'shield') return isDouble && defense.hand !== 'both' ? 'hit' : 'blocked';
	if (defense.action === 'mirror') return isDouble ? 'hit' : 'reflected';
	return 'hit'; // Reload (or anything else) doesn't protect you
}

function applyMoves() {
	for (const p of ['p1', 'p2']) {
		const m = turn[p];
		if (m.action === 'reload') bullets[p][m.hand] = Math.min(MAX_AMMO, bullets[p][m.hand] + 1);
		if (m.action === 'shoot') {
			const cost = m.hand === 'both' ? 3 : 1;
			(m.hand === 'both' ? ['left', 'right'] : [m.hand]).forEach((h) => (bullets[p][h] -= cost));
		}
		shieldedLastTurn[p] = m.action === 'shield';
	}
}

function revealMoves() {
	revealing = true;
	let text = `Player 1: ${describeMove(turn.p1)} | Player 2: ${describeMove(turn.p2)}`;
	let winner = null;
	for (const [s, t] of [['p1', 'p2'], ['p2', 'p1']]) {
		if (turn[s].action !== 'shoot') continue;
		const result = shotOutcome(turn[s], turn[t]);
		if (result === 'hit') winner = s;
		else if (result === 'reflected') winner = t;
		else if (result === 'blocked') text += ` | Player ${t[1]} blocked the shot`;
		else if (result === 'cancel' && s === 'p1') text += ' | Shots cancelled out';
	}
	applyMoves();
	renderBullets();
	if (winner) {
		gameOver = true;
		setStatus(`${text} | Player ${winner[1]} wins!`);
		return;
	}
	setStatus(text);
	revealTimer = setTimeout(resetTurn, 2500);
}

document.addEventListener('keydown', (event) => {
	if (event.repeat) return;
	const key = event.key.toLowerCase();
	heldKeys.add(key);
	if (currentScreen !== 'game' || revealing || gameOver || isHelpOpen()) return;

	const bind = keyMap[key];
	if (!bind || bind.action === 'double' || turn[bind.player]) return;

	// Holding a double key while pressing Shoot or Shield makes it a double move.
	const move = { action: bind.action, hand: bind.hand };
	const doubleHeld = doubleKeys[bind.player].some((k) => heldKeys.has(k));
	if (doubleHeld && (bind.action === 'shoot' || bind.action === 'shield')) {
		move.hand = 'both';
	}
	const n = bind.player === 'p1' ? 1 : 2;
	const problem = checkMove(bind.player, move);
	if (problem) {
		setStatus(`Player ${n}: ${problem} Pick another move.`);
		return;
	}
	turn[bind.player] = move;

	if (turn.p1 && turn.p2) {
		revealMoves();
	} else {
		setStatus(`Player ${n} is ready. Waiting for Player ${3 - n}...`);
	}
});

document.addEventListener('keyup', (event) => heldKeys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => heldKeys.clear());
